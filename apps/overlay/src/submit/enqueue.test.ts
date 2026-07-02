import { describe, it, expect, vi } from "vitest";

import { SessionAgentEnqueuer } from "./enqueue.js";

describe("SessionAgentEnqueuer", () => {
  const base = { supabaseUrl: "https://x.supabase.co", supabaseAnonKey: "anon" };

  it("calls enqueue_review_comment with the comment id + current token and returns true", async () => {
    const calls: Array<{ id: string; token: string }> = [];
    const enq = new SessionAgentEnqueuer({
      ...base,
      getAccessToken: () => "tok-123",
      rpc: async (id, token) => {
        calls.push({ id, token });
      },
    });
    expect(await enq.enqueue("c1")).toBe(true);
    expect(calls).toEqual([{ id: "c1", token: "tok-123" }]);
  });

  it("awaits an async getAccessToken (refresh-before-write)", async () => {
    let seen = "";
    const enq = new SessionAgentEnqueuer({
      ...base,
      getAccessToken: async () => "fresh",
      rpc: async (_id, token) => {
        seen = token;
      },
    });
    await enq.enqueue("c1");
    expect(seen).toBe("fresh");
  });

  it("returns false when the RPC fails (best-effort — never breaks the save)", async () => {
    const enq = new SessionAgentEnqueuer({
      ...base,
      getAccessToken: () => "t",
      rpc: async () => {
        throw new Error("enqueue_review_comment failed (403): not_permitted");
      },
    });
    expect(await enq.enqueue("c1")).toBe(false);
  });

  it("returns false for an empty comment id without calling the RPC", async () => {
    const rpc = vi.fn();
    const enq = new SessionAgentEnqueuer({ ...base, getAccessToken: () => "t", rpc });
    expect(await enq.enqueue("")).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("requires a supabase url + anon key", () => {
    expect(
      () =>
        new SessionAgentEnqueuer({
          supabaseUrl: "",
          supabaseAnonKey: "anon",
          getAccessToken: () => "t",
        }),
    ).toThrow();
  });
});
