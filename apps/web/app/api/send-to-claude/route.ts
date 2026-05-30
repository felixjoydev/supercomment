import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { requireMember, type VerifiedClaims } from "@/lib/auth-guard";
import { canEnqueue } from "@/lib/comments/view";

export const dynamic = "force-dynamic";

/**
 * "Send to Claude" enqueue endpoint (R20 + R23).
 *
 * POST { commentId, confirmGuest? } → inserts a `comment_queue` row (status
 * pending) for the local MCP queue consumer (U5/U12) to deliver to the agent.
 * The actual local delivery happens off-platform; here we only enqueue and
 * report sent / working / failed via the row's status.
 *
 * Authz enforced HERE (mirrors app/api/previews/[id]/route.ts): verify the user
 * (getClaims), confirm preview team membership (is_preview_team_member), THEN
 * insert via the RLS-scoped client. The UI hides the button for non-members,
 * but the server is the source of truth.
 *
 * R23 guest gate: a guest-authored comment is UNTRUSTED to the agent and is
 * BLOCKED unless `confirmGuest === true` is explicitly supplied. Member
 * comments enqueue directly.
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const commentId =
    body && typeof body === "object" && typeof (body as { commentId?: unknown }).commentId === "string"
      ? (body as { commentId: string }).commentId
      : "";
  const confirmGuest =
    !!body && typeof body === "object" && (body as { confirmGuest?: unknown }).confirmGuest === true;

  if (!commentId) {
    return NextResponse.json({ error: "commentId is required" }, { status: 400 });
  }

  const supabase = await createClient();

  // Load the comment (RLS-scoped) so we know its preview + trust level.
  const { data: comment, error: loadError } = await supabase
    .from("comments")
    .select("id, preview_id, trust_level")
    .eq("id", commentId)
    .maybeSingle();

  if (loadError) {
    return NextResponse.json({ error: "Failed to load comment" }, { status: 500 });
  }
  if (!comment) {
    return NextResponse.json({ error: "Comment not found" }, { status: 404 });
  }

  // Authorize against the comment's preview team (owner/dev/member).
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = (claimsData?.claims ?? null) as VerifiedClaims | null;
  const { data: isMember } = await supabase.rpc("is_preview_team_member", {
    p_preview_id: comment.preview_id,
  });
  const guard = requireMember(claims, isMember === true);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  // R23: gate guest comments behind explicit confirmation.
  const gate = canEnqueue({ trustLevel: comment.trust_level }, confirmGuest);
  if (!gate.ok) {
    return NextResponse.json(
      {
        error: "guest_confirm_required",
        trustLevel: comment.trust_level,
        message:
          "Guest comments must be explicitly confirmed before sending to the agent.",
      },
      { status: 409 },
    );
  }

  // Enqueue. The partial unique index (0006) makes a re-send while an attempt
  // is already pending/working a benign conflict; surface that as "already
  // queued" rather than an error.
  const { data: queued, error: insertError } = await supabase
    .from("comment_queue")
    .insert({
      preview_id: comment.preview_id,
      comment_id: comment.id,
      requested_by: claims?.sub ?? null,
      status: "pending",
    })
    .select("id, status")
    .maybeSingle();

  if (insertError) {
    const isDuplicate =
      insertError.code === "23505" ||
      /duplicate key|comment_queue_active_uniq/i.test(insertError.message ?? "");
    if (isDuplicate) {
      return NextResponse.json({ ok: true, status: "pending", deduped: true }, { status: 200 });
    }
    return NextResponse.json({ error: "Failed to enqueue" }, { status: 500 });
  }

  // VERIFY IN REAL ENV: the local MCP queue consumer (U5/U12) reads this row
  // over the outbound channel and reports back working→done. End-to-end local
  // delivery cannot be exercised in this sandbox.
  return NextResponse.json(
    { ok: true, status: queued?.status ?? "pending", queueId: queued?.id ?? null },
    { status: 201 },
  );
}
