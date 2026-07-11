import { describe, it, expect, vi, afterEach } from "vitest";

import { SessionAgentEnqueuer } from "./enqueue.js";

afterEach(() => vi.unstubAllGlobals());

describe("SessionAgentEnqueuer", () => {
  const base = { supabaseUrl: "https://x.supabase.co", supabaseAnonKey: "anon" };

  it("calls send_comment_to_agent with the comment id + current token and returns true", async () => {
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
        throw new Error("send_comment_to_agent failed (403): not_permitted");
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

  // U3 (0044): with no injected `rpc`, the real fetch-based caller hits
  // send_comment_to_agent (not the old enqueue_review_comment) and always
  // sends p_confirm_guest: true — the overlay's "Send to agent" footer button
  // only ever enqueues a member-authored template (see enqueue.ts's class doc
  // for why this is a safe no-op on this call site, not a bypassed gate).
  it("the default fetch-based RPC caller posts to send_comment_to_agent with p_confirm_guest: true", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true }) as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    const enq = new SessionAgentEnqueuer({ ...base, getAccessToken: () => "tok-abc" });
    expect(await enq.enqueue("c1")).toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://x.supabase.co/rest/v1/rpc/send_comment_to_agent");
    expect((opts.headers as Record<string, string>).Authorization).toBe("Bearer tok-abc");
    expect(JSON.parse(opts.body as string)).toEqual({
      p_comment_id: "c1",
      p_confirm_guest: true,
    });
  });

  it("the default fetch-based RPC caller returns false (via enqueue) on a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 403, statusText: "Forbidden", text: async () => "not_permitted" }) as unknown as Response),
    );
    const enq = new SessionAgentEnqueuer({ ...base, getAccessToken: () => "t" });
    expect(await enq.enqueue("c1")).toBe(false);
  });
});
