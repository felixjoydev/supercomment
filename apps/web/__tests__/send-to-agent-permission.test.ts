import { describe, it, expect, vi } from "vitest";

import {
  authorizeSendToAgent,
  canShowSendButton,
  canEnqueue,
} from "../lib/comments/view";

/**
 * Phase 2 — send-to-agent per-member permission (web side). Node env, pure logic
 * + a mocked Supabase client mirroring app/api/send-to-claude/route.ts. The DB
 * enforcement (can_user_send_to_agent / set_member_send_to_agent, owner-gated)
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
  // Mirrors the route: after membership, it checks can_user_send_to_agent and
  // rejects with 403 when the RPC returns anything but true.
  function fakeSupabase(opts: { isMember: boolean; canSend: boolean | null }) {
    const insert = vi.fn().mockReturnValue({
      select: () => ({
        maybeSingle: () =>
          Promise.resolve({ data: { id: "q1", status: "pending" }, error: null }),
      }),
    });
    const rpc = vi.fn(async (name: string) => {
      if (name === "is_preview_workspace_member") return { data: opts.isMember };
      if (name === "can_user_send_to_agent") return { data: opts.canSend };
      return { data: null };
    });
    return { rpc, from: () => ({ insert }), _insert: insert };
  }

  async function routeEnqueue(
    supabase: ReturnType<typeof fakeSupabase>,
    comment: { id: string; previewId: string; trustLevel: "member" | "guest" },
    confirmGuest: boolean,
  ) {
    const { data: isMember } = await supabase.rpc("is_preview_workspace_member");
    if (isMember !== true) return { status: 403 as const, error: "not_member" };
    const { data: canSend } = await supabase.rpc("can_user_send_to_agent");
    if (canSend !== true) return { status: 403 as const, error: "send_to_agent_forbidden" };
    const gate = canEnqueue(comment, confirmGuest);
    if (!gate.ok) return { status: 409 as const, error: gate.reason };
    await supabase
      .from()
      .insert({ preview_id: comment.previewId, comment_id: comment.id, status: "pending" })
      .select("id, status")
      .maybeSingle();
    return { status: 201 as const };
  }

  const member = { id: "c1", previewId: "p1", trustLevel: "member" as const };

  it("permitted member enqueues (201, inserts a queue row)", async () => {
    const supabase = fakeSupabase({ isMember: true, canSend: true });
    const r = await routeEnqueue(supabase, member, false);
    expect(r.status).toBe(201);
    expect(supabase._insert).toHaveBeenCalledTimes(1);
  });

  it("member WITHOUT the grant is rejected 403 and never inserts", async () => {
    const supabase = fakeSupabase({ isMember: true, canSend: false });
    const r = await routeEnqueue(supabase, member, false);
    expect(r).toEqual({ status: 403, error: "send_to_agent_forbidden" });
    expect(supabase._insert).not.toHaveBeenCalled();
  });

  it("non-member (guest) is rejected 403 before the permission check", async () => {
    const supabase = fakeSupabase({ isMember: false, canSend: null });
    const r = await routeEnqueue(supabase, member, false);
    expect(r).toEqual({ status: 403, error: "not_member" });
    expect(supabase._insert).not.toHaveBeenCalled();
  });
});
