import { NextResponse, type NextRequest } from "next/server";

import type { CapturedContext } from "@supercomment/shared";

import { createClient } from "@/lib/supabase/server";
import { requireMemberOfPreview } from "@/lib/api-auth";
import { jsonError } from "@/lib/api-response";
import { canEnqueue } from "@/lib/comments/view";
import { handoffSourceRef } from "@/lib/comments/handoff";

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
 * (getClaims), confirm preview workspace membership (is_preview_workspace_member), THEN
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
  // R10: the dashboard's "Include file:line in AI hand-offs" toggle (default ON).
  // Only an explicit `false` withholds the source location; absent/anything else
  // keeps the default-on behavior.
  const includeSource =
    !(body && typeof body === "object" && (body as { includeSource?: unknown }).includeSource === false);

  if (!commentId) {
    return jsonError("commentId is required", 400);
  }

  const supabase = await createClient();

  // Load the comment (RLS-scoped) so we know its preview + trust level, plus the
  // captured context so the hand-off can carry the exact file:line (R10/R11).
  const { data: comment, error: loadError } = await supabase
    .from("comments")
    .select("id, preview_id, trust_level, context")
    .eq("id", commentId)
    .maybeSingle();

  if (loadError) {
    return jsonError("Failed to load comment", 500);
  }
  if (!comment) {
    return jsonError("Comment not found", 404);
  }

  // Authorize against the comment's preview workspace (owner/dev/member).
  const auth = await requireMemberOfPreview(supabase, comment.preview_id);
  if (!auth.ok) return auth.response;

  // Phase 2 (send-to-agent permission): membership is necessary but NOT
  // sufficient. Only a workspace member explicitly granted `can_send_to_agent`
  // may enqueue to the coding agent — a coding agent runs on a member's machine
  // via the MCP + a linked repo, so this is governed per-member by the workspace
  // owner. This is the REAL guard (the dashboard button visibility is UX only);
  // guests never reach here (requireMember already blocked them).
  const { data: canSend } = await supabase.rpc("can_user_send_to_agent", {
    p_preview_id: comment.preview_id,
  });
  if (canSend !== true) {
    return NextResponse.json(
      {
        error: "send_to_agent_forbidden",
        message:
          "You don't have permission to send comments to the agent. Ask a workspace owner to enable it for you.",
      },
      { status: 403 },
    );
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

  // R10/R11: the exact file:line for the clicked element, attached to the
  // hand-off only when the comment carries a build-time source stamp AND the
  // dashboard toggle is on. The queue row is a pointer (comment_id); the full
  // captured context — including this source location — travels to the agent via
  // the MCP `get_comment` read, so this `sourceRef` is the explicit, gated echo
  // of what the developer is handing off.
  const sourceRef = handoffSourceRef(
    (comment.context ?? null) as CapturedContext | null,
    includeSource,
  );

  // Enqueue. The partial unique index (0006) makes a re-send while an attempt
  // is already pending/working a benign conflict; surface that as "already
  // queued" rather than an error.
  const { data: queued, error: insertError } = await supabase
    .from("comment_queue")
    .insert({
      preview_id: comment.preview_id,
      comment_id: comment.id,
      requested_by: auth.claims?.sub ?? null,
      status: "pending",
    })
    .select("id, status")
    .maybeSingle();

  if (insertError) {
    const isDuplicate =
      insertError.code === "23505" ||
      /duplicate key|comment_queue_active_uniq/i.test(insertError.message ?? "");
    if (isDuplicate) {
      return NextResponse.json(
        { ok: true, status: "pending", deduped: true, sourceRef },
        { status: 200 },
      );
    }
    return jsonError("Failed to enqueue", 500);
  }

  // VERIFY IN REAL ENV: the local MCP queue consumer (U5/U12) reads this row
  // over the outbound channel and reports back working→done. End-to-end local
  // delivery cannot be exercised in this sandbox.
  return NextResponse.json(
    { ok: true, status: queued?.status ?? "pending", queueId: queued?.id ?? null, sourceRef },
    { status: 201 },
  );
}
