import { describe, it, expect, vi } from "vitest";

import {
  authorizeSendToAgent,
  canShowSendButton,
} from "../lib/comments/view";

/**
 * Phase 2 — send-to-agent per-member permission (web side). Node env, pure logic
 * + a mocked Supabase client mirroring app/api/send-to-claude/route.ts. The DB
 * enforcement (can_user_send_to_agent / set_member_send_to_agent, owner-gated;
 * and, since U5, the set_comment_lane RPC's own inline permission check)
 * is verified separately against the live DB in a rolled-back transaction.
 */

describe("comment-card send button visibility (canShowSendButton)", () => {
  it("shows only for a member who is granted send-to-agent", () => {
    expect(canShowSendButton({ canMutate: true, canSendToAgent: true })).toBe(true);
  });

  it("hides for a member WITHOUT the grant", () => {
    expect(canShowSendButton({ canMutate: true, canSendToAgent: false })).toBe(false);
  });

  it("hides when the user cannot mutate (guest / non-member)", () => {
    expect(canShowSendButton({ canMutate: false, canSendToAgent: true })).toBe(false);
    expect(canShowSendButton({ canMutate: false, canSendToAgent: false })).toBe(false);
  });
});

describe("server enqueue authorization (authorizeSendToAgent)", () => {
  it("permits a member granted send-to-agent", () => {
    expect(authorizeSendToAgent({ isMember: true, canSendToAgent: true })).toEqual({
      ok: true,
    });
  });

  it("rejects a member WITHOUT the grant with 403 send_to_agent_forbidden", () => {
    expect(authorizeSendToAgent({ isMember: true, canSendToAgent: false })).toEqual({
      ok: false,
      status: 403,
      reason: "send_to_agent_forbidden",
    });
  });

  it("rejects a non-member (guest) with 403 not_member", () => {
    expect(authorizeSendToAgent({ isMember: false, canSendToAgent: false })).toEqual({
      ok: false,
      status: 403,
      reason: "not_member",
    });
  });
});

describe("send-to-claude route decision (mocked) enforces the send-to-agent gate", () => {
  // Mirrors the route post-U5: a preview-membership pre-check (for the
  // existing 401/403 shape on a non-member), then ONE call to the
  // set_comment_lane RPC (p_lane='ready_for_agent'), which itself re-verifies
  // membership + can_send_to_agent + the guest-confirm gate and does the lane
  // move — there is no more separate can_user_send_to_agent call nor any
  // comment_queue insert from the route.
  function fakeSupabase(opts: {
    isMember: boolean;
    rpcResult: { data?: unknown; error?: { code: string; message: string } | null };
  }) {
    const rpc = vi.fn(async (name: string, _args?: Record<string, unknown>) => {
      if (name === "is_preview_workspace_member") return { data: opts.isMember };
      if (name === "set_comment_lane") {
        return { data: opts.rpcResult.data ?? null, error: opts.rpcResult.error ?? null };
      }
      return { data: null };
    });
    return { rpc, _rpc: rpc };
  }

  async function routeEnqueue(
    supabase: ReturnType<typeof fakeSupabase>,
    comment: { id: string; previewId: string },
    confirmGuest: boolean,
  ) {
    const { data: isMember } = await supabase.rpc("is_preview_workspace_member");
    if (isMember !== true) return { status: 403 as const, error: "not_member" };
    const { data, error } = await supabase.rpc("set_comment_lane", {
      p_comment_id: comment.id,
      p_lane: "ready_for_agent",
      p_confirm_guest: confirmGuest,
    });
    if (error) {
      if (error.code === "P0002") return { status: 409 as const, error: "guest_confirm_required" };
      if (error.code === "42501") return { status: 403 as const, error: "send_to_agent_forbidden" };
      if (error.code === "P0001") return { status: 409 as const, error: "comment_not_open" };
      return { status: 500 as const, error: "enqueue_failed" };
    }
    return { status: 201 as const, lane: typeof data === "string" ? data : "ready_for_agent" };
  }

  const member = { id: "c1", previewId: "p1" };

  it("permitted member moves to ready_for_agent (201, RPC returns the new lane)", async () => {
    const supabase = fakeSupabase({
      isMember: true,
      rpcResult: { data: "ready_for_agent" },
    });
    const r = await routeEnqueue(supabase, member, false);
    expect(r.status).toBe(201);
    expect(supabase._rpc).toHaveBeenCalledWith("set_comment_lane", {
      p_comment_id: "c1",
      p_lane: "ready_for_agent",
      p_confirm_guest: false,
    });
  });

  it("member WITHOUT the grant is rejected 403 (RPC raises send_to_agent_forbidden / 42501)", async () => {
    const supabase = fakeSupabase({
      isMember: true,
      rpcResult: { error: { code: "42501", message: "send_to_agent_forbidden" } },
    });
    const r = await routeEnqueue(supabase, member, false);
    expect(r).toEqual({ status: 403, error: "send_to_agent_forbidden" });
  });

  it("non-member (guest) is rejected 403 before the RPC is ever called", async () => {
    const supabase = fakeSupabase({
      isMember: false,
      rpcResult: { error: { code: "42501", message: "not_authorized" } },
    });
    const r = await routeEnqueue(supabase, member, false);
    expect(r).toEqual({ status: 403, error: "not_member" });
    expect(supabase._rpc).toHaveBeenCalledTimes(1);
    expect(supabase._rpc).not.toHaveBeenCalledWith("set_comment_lane", expect.anything());
  });

  it("an unconfirmed guest-authored comment is rejected 409 (RPC raises guest_confirm_required / P0002)", async () => {
    const supabase = fakeSupabase({
      isMember: true,
      rpcResult: { error: { code: "P0002", message: "guest_confirm_required" } },
    });
    const r = await routeEnqueue(supabase, member, false);
    expect(r).toEqual({ status: 409, error: "guest_confirm_required" });
  });
});
