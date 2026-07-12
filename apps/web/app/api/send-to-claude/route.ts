import { NextResponse, type NextRequest } from "next/server";

import type { CapturedContext } from "@supercomment/shared";

import { createClient } from "@/lib/supabase/server";
import { requireMemberOfPreview } from "@/lib/api-auth";
import { jsonError } from "@/lib/api-response";
import { handoffSourceRef } from "@/lib/comments/handoff";

export const dynamic = "force-dynamic";

/**
 * "Send to agent" endpoint (R20 + R23, R7/R11) — now the LANE transition (U5).
 *
 * POST { commentId, confirmGuest? } → calls the `set_comment_lane` RPC
 * (0052), which moves the comment to the `ready_for_agent` lane. That lane IS
 * the agent's pull queue, so this subsumes what `send_comment_to_agent` did —
 * membership + can_send_to_agent + the guest-confirm gate + the guest
 * reference-image unlock (`agent_reference_confirmations`) — in one
 * transaction, but WITHOUT the dead `comment_queue` insert (the queue table is
 * left dormant, retired in a later cleanup unit). There is no background
 * consumer to report working/done anymore; the lane itself is the status.
 *
 * Authz: this route still verifies the user (getClaims) and preview workspace
 * membership (requireMemberOfPreview) BEFORE calling the RPC, purely so a
 * non-member gets the existing 401/403 response shape this route has always
 * returned (the RPC itself re-verifies membership + can_send_to_agent + the
 * guest-confirm gate server-side regardless — it is the real guard, not this
 * pre-check).
 *
 * R23/R11 guest gate: a guest-authored comment is UNTRUSTED to the agent and
 * is BLOCKED unless `confirmGuest === true` is explicitly supplied — enforced
 * by the RPC itself (SQLSTATE P0002 / message 'guest_confirm_required'),
 * mapped below back to the same 409 JSON shape this route has always returned
 * so the dashboard UI's existing confirm flow keeps working unchanged.
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

  // U5: one atomic RPC does membership + can_send_to_agent + the guest-confirm
  // gate + the guest reference-image unlock + the lane move, all in one
  // transaction (see supabase/migrations/0052_comment_workflow_lane.sql). It
  // returns the new lane text ('ready_for_agent'); moving an already-sent
  // comment is idempotent (no dedup distinction — the lane is just re-set).
  const { data: newLane, error: rpcError } = await supabase.rpc("set_comment_lane", {
    p_comment_id: comment.id,
    p_lane: "ready_for_agent",
    p_confirm_guest: confirmGuest,
  });

  if (rpcError) {
    // P0002 is the dedicated errcode for the guest-confirm gate (message
    // 'guest_confirm_required'); 42501 covers both plain authz rejections
    // (not_authorized / send_to_agent_forbidden), folded into the same 403.
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
    // P0001 now also covers "comment is no longer open" — set_comment_lane
    // refuses to move a resolved/dismissed comment's lane (something the old
    // send path never enforced). Surface it as a 409 the UI can explain,
    // rather than a generic 500.
    if (rpcError.code === "P0001") {
      return NextResponse.json(
        {
          error: "comment_not_open",
          message:
            "This comment is no longer open, so it can't be sent to the agent.",
        },
        { status: 409 },
      );
    }
    return jsonError("Failed to send to agent", 500);
  }

  const lane = typeof newLane === "string" ? newLane : "ready_for_agent";

  return NextResponse.json({ ok: true, lane, sourceRef }, { status: 201 });
}
