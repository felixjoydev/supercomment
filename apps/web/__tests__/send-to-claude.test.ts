import { describe, it, expect, vi } from "vitest";

import { canEnqueue, requiresGuestConfirm } from "../lib/comments/view";
import type { CommentView } from "../lib/comments/types";
import { handoffSourceRef, sourceRefFromContext } from "../lib/comments/handoff";
import type { CapturedContext } from "@supercomment/shared";

/**
 * U9 Send-to-Claude — R20 enqueue + R23 guest-confirm gate, plus the pure
 * button state machine (sent → working → failed). Node env, pure logic +
 * mocked Supabase insert client; no DOM/network.
 *
 * VERIFY IN REAL ENV: the local MCP queue consumer (U5/U12) actually reading
 * the comment_queue row over the outbound channel and reporting working→done
 * cannot be exercised here.
 */

function comment(trust: "member" | "guest"): Pick<CommentView, "trustLevel"> {
  return { trustLevel: trust };
}

describe("R23 guest-confirm gate (canEnqueue / requiresGuestConfirm)", () => {
  it("member comment never requires confirm and enqueues directly", () => {
    expect(requiresGuestConfirm(comment("member"))).toBe(false);
    expect(canEnqueue(comment("member"), false)).toEqual({ ok: true });
  });

  it("guest comment requires confirm and is BLOCKED until confirmed", () => {
    expect(requiresGuestConfirm(comment("guest"))).toBe(true);
    expect(canEnqueue(comment("guest"), false)).toEqual({
      ok: false,
      reason: "guest_confirm_required",
    });
  });

  it("guest comment enqueues once explicitly confirmed", () => {
    expect(canEnqueue(comment("guest"), true)).toEqual({ ok: true });
  });
});

describe("server send path (mocked) honors the R23/R11 gate via set_comment_lane (U5)", () => {
  // Mirrors app/api/send-to-claude/route.ts's POST-U5 decision logic: "Send to
  // agent" IS the lane move now. The route ALWAYS calls the set_comment_lane
  // RPC (p_lane='ready_for_agent', passing p_confirm_guest through) and maps
  // the RPC's own rejection back onto the same HTTP shape: SQLSTATE P0002
  // (guest_confirm_required) -> 409, 42501 (not_authorized /
  // send_to_agent_forbidden) -> 403, P0001 (comment no longer open) -> 409.
  // On success the RPC returns the new lane text (a scalar), and NO
  // comment_queue row is written — the ready_for_agent lane is the queue.
  function fakeRpc(result: { data?: unknown; error?: { code: string; message: string } | null }) {
    const rpc = vi.fn().mockResolvedValue({ data: result.data ?? null, error: result.error ?? null });
    return { rpc, _rpc: rpc };
  }

  async function sendViaRpc(
    c: Pick<CommentView, "trustLevel"> & { id: string; previewId: string },
    confirmGuest: boolean,
    supabase: ReturnType<typeof fakeRpc>,
  ) {
    const { data, error } = await supabase.rpc("set_comment_lane", {
      p_comment_id: c.id,
      p_lane: "ready_for_agent",
      p_confirm_guest: confirmGuest,
    });
    if (error) {
      if (error.code === "P0002") {
        return { status: 409 as const, reason: "guest_confirm_required" as const };
      }
      if (error.code === "42501") {
        return { status: 403 as const, reason: "send_to_agent_forbidden" as const };
      }
      if (error.code === "P0001") {
        return { status: 409 as const, reason: "comment_not_open" as const };
      }
      return { status: 500 as const };
    }
    const lane = typeof data === "string" ? data : "ready_for_agent";
    return { status: 201 as const, lane };
  }

  it("MEMBER comment moves straight to ready_for_agent (RPC returns the new lane)", async () => {
    const supabase = fakeRpc({ data: "ready_for_agent" });
    const r = await sendViaRpc({ id: "c1", previewId: "p1", trustLevel: "member" }, false, supabase);
    expect(r.status).toBe(201);
    expect(supabase._rpc).toHaveBeenCalledTimes(1);
    expect((r as { lane: string }).lane).toBe("ready_for_agent");
    // No comment_queue row: the RPC is called with the lane args, not a queue insert.
    expect(supabase._rpc).toHaveBeenCalledWith("set_comment_lane", {
      p_comment_id: "c1",
      p_lane: "ready_for_agent",
      p_confirm_guest: false,
    });
  });

  it("a re-send is idempotent and still returns 201 with the lane (no dedup distinction)", async () => {
    // set_comment_lane just re-sets the lane (and re-confirms a guest raster);
    // there is no comment_queue and thus no fresh-insert-vs-already-queued
    // shape to distinguish — every send is an ordinary 201.
    const supabase = fakeRpc({ data: "ready_for_agent" });
    const r = await sendViaRpc({ id: "c1", previewId: "p1", trustLevel: "member" }, false, supabase);
    expect(r.status).toBe(201);
    expect((r as { lane: string; deduped?: boolean }).deduped).toBeUndefined();
  });

  it("GUEST comment without confirm is rejected with 409 (RPC raises guest_confirm_required / P0002)", async () => {
    const supabase = fakeRpc({ error: { code: "P0002", message: "guest_confirm_required" } });
    const r = await sendViaRpc({ id: "c2", previewId: "p1", trustLevel: "guest" }, false, supabase);
    expect(r.status).toBe(409);
    // The RPC is still CALLED (it is the one enforcing the gate now) — it just rejects.
    expect(supabase._rpc).toHaveBeenCalledTimes(1);
  });

  it("GUEST comment WITH explicit confirm moves to ready_for_agent", async () => {
    const supabase = fakeRpc({ data: "ready_for_agent" });
    const r = await sendViaRpc({ id: "c3", previewId: "p1", trustLevel: "guest" }, true, supabase);
    expect(r.status).toBe(201);
    expect(supabase._rpc).toHaveBeenCalledTimes(1);
  });

  it("a member without can_send_to_agent granted is rejected with 403 (RPC raises 42501)", async () => {
    const supabase = fakeRpc({ error: { code: "42501", message: "send_to_agent_forbidden" } });
    const r = await sendViaRpc({ id: "c4", previewId: "p1", trustLevel: "member" }, false, supabase);
    expect(r.status).toBe(403);
  });

  it("a resolved/dismissed comment can no longer be sent (RPC raises comment_not_open / P0001 -> 409)", async () => {
    const supabase = fakeRpc({ error: { code: "P0001", message: "comment_not_open" } });
    const r = await sendViaRpc({ id: "c5", previewId: "p1", trustLevel: "member" }, false, supabase);
    expect(r.status).toBe(409);
    expect((r as { reason?: string }).reason).toBe("comment_not_open");
  });
});

// The per-comment "Send" button + its send-state machine were retired in U9:
// "Send to agent" is now the Ready-for-agent LANE move (LaneControl / the board
// drag), covered by comment-lanes.test.ts + the RPC-level lane tests. The route
// decision + guest-confirm gate above and the hand-off source ref below are the
// parts of this file still in force.

/**
 * U6 enhanced-context hand-off (R10/R11): the exact `file:line` is attached to
 * the Send-to-Claude hand-off only when the comment carries a build-time source
 * stamp AND the dashboard "include file:line" toggle is on.
 */
function contextWithSource(sourceFile?: string, sourceLine?: number): CapturedContext {
  return {
    selector: "#el",
    anchors: [],
    url: "https://example.com",
    consoleErrors: [],
    ...(sourceFile
      ? {
          react: {
            componentPath: ["App", "Card"],
            sourceFile,
            ...(sourceLine ? { sourceLine } : {}),
          },
        }
      : {}),
  } as CapturedContext;
}

describe("R10/R11 enhanced-context hand-off (handoffSourceRef)", () => {
  it("includes file:line when source is present and the toggle is on", () => {
    const ctx = contextWithSource("src/components/Card.tsx", 42);
    expect(handoffSourceRef(ctx, true)).toBe("src/components/Card.tsx:42");
  });

  it("includes the file alone when only the file (no line) was stamped", () => {
    const ctx = contextWithSource("src/components/Card.tsx");
    expect(handoffSourceRef(ctx, true)).toBe("src/components/Card.tsx");
  });

  it("omits file:line when the comment has no source stamp (AE7)", () => {
    expect(handoffSourceRef(contextWithSource(), true)).toBeNull();
    expect(handoffSourceRef(null, true)).toBeNull();
  });

  it("withholds file:line when the toggle is off, even when present", () => {
    const ctx = contextWithSource("src/components/Card.tsx", 42);
    expect(handoffSourceRef(ctx, false)).toBeNull();
  });

  it("sourceRefFromContext formats the same way without gating", () => {
    expect(sourceRefFromContext(contextWithSource("a/b.tsx", 7))).toBe("a/b.tsx:7");
    expect(sourceRefFromContext(contextWithSource())).toBeNull();
  });

  it("the enqueue hand-off payload carries the gated source ref", () => {
    // Mirrors the { commentId, confirmGuest, sourceRef } shape the
    // /api/send-to-claude route assembles: present when enabled, null when off.
    const ctx = contextWithSource("src/Card.tsx", 42);
    const on = { commentId: "c1", confirmGuest: false, sourceRef: handoffSourceRef(ctx, true) };
    const off = { commentId: "c1", confirmGuest: false, sourceRef: handoffSourceRef(ctx, false) };
    expect(on.sourceRef).toBe("src/Card.tsx:42");
    expect(off.sourceRef).toBeNull();
  });
});
