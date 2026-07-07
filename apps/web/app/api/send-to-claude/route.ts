import { NextResponse, type NextRequest } from "next/server";

import type { CapturedContext } from "@supercomment/shared";

import { createClient } from "@/lib/supabase/server";
import { requireMemberOfPreview } from "@/lib/api-auth";
import { jsonError } from "@/lib/api-response";
import { handoffSourceRef } from "@/lib/comments/handoff";

export const dynamic = "force-dynamic";

/**
 * "Send to Claude" enqueue endpoint (R20 + R23, R7/R11 via U3).
 *
 * POST { commentId, confirmGuest? } → calls the `send_comment_to_agent` RPC
 * (0044/U3), which ATOMICALLY enqueues a `comment_queue` row (status pending),
 * stamps a point-in-time snapshot of the live agent_prompt onto it (R7), and
 * (guest-authored comments only) records a member-only confirm marker (R11).
 * The actual local delivery happens off-platform; here we only enqueue and
 * report sent / working / failed via the row's status.
 *
 * Authz: this route still verifies the user (getClaims) and preview workspace
 * membership (requireMemberOfPreview) BEFORE calling the RPC, purely so a
 * non-member gets the existing 401/403 response shape this route has always
 * returned (the RPC itself re-verifies membership + can_send_to_agent +
 * the guest-confirm gate server-side regardless — it is the real guard, not
 * this pre-check). The RPC replaces what used to be a direct
 * `comment_queue` insert; canEnqueue()/can_user_send_to_agent are no longer
 * called here since the RPC re-does both checks atomically inside the same
 * transaction as the insert.
 *
 * R23/R11 guest gate: a guest-authored comment is UNTRUSTED to the agent and
 * is BLOCKED unless `confirmGuest === true` is explicitly supplied — now
 * enforced by the RPC itself (SQLSTATE P0002 / message
 * 'guest_confirm_required'), mapped below back to the same 409 JSON shape
 * this route has always returned so the dashboard UI's existing confirm flow
 * keeps working unchanged.
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

  // Authorize against the comment's preview workspace (owner/dev/member). This
  // is a pre-check only, kept so a non-member still gets this route's existing
  // 401/403 shape — the RPC below re-verifies membership + can_send_to_agent
  // itself and is the real guard.
  const auth = await requireMemberOfPreview(supabase, comment.preview_id);
  if (!auth.ok) return auth.response;

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

  // U3: one atomic RPC does membership + can_send_to_agent + the guest-confirm
  // gate + the enqueue + the prompt snapshot + the guest confirm marker, all in
  // one transaction (see supabase/migrations/0044_send_comment_to_agent.sql).
  // The partial unique index (0006) still backs the RPC's own dedup — a
  // re-send while an attempt is already pending/working comes back as the
  // SAME existing row rather than an error. `send_comment_to_agent` returns
  // `setof comment_queue` (a real empty array on the not-permitted/rejected
  // paths, never a bare-rowtype null row — see 0044's header note), so `data`
  // comes back as an array here, matching the create_review_reply convention
  // elsewhere in this codebase.
  const { data: rpcData, error: rpcError } = await supabase.rpc("send_comment_to_agent", {
    p_comment_id: comment.id,
    p_confirm_guest: confirmGuest,
  });

  if (rpcError) {
    // P0002 is send_comment_to_agent's dedicated errcode for the guest-confirm
    // gate (message 'guest_confirm_required'); 42501 covers both of its plain
    // authz rejections (not_authorized / send_to_agent_forbidden), which this
    // route has always folded into the same 403 response.
    if (rpcError.code === "P0002") {
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
    if (rpcError.code === "42501") {
      return NextResponse.json(
        {
          error: "send_to_agent_forbidden",
          message:
            "You don't have permission to send comments to the agent. Ask a workspace owner to enable it for you.",
        },
        { status: 403 },
      );
    }
    return jsonError("Failed to enqueue", 500);
  }

  const queued = Array.isArray(rpcData) ? rpcData[0] : rpcData;

  // VERIFY IN REAL ENV: the local MCP queue consumer (U5/U12) reads this row
  // over the outbound channel and reports back working→done. End-to-end local
  // delivery cannot be exercised in this sandbox.
  return NextResponse.json(
    { ok: true, status: queued?.status ?? "pending", queueId: queued?.id ?? null, sourceRef },
    { status: 201 },
  );
}
