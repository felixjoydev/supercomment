import { describe, it, expect, vi, afterEach } from "vitest";

import { SessionLaneClient } from "./lane.js";

afterEach(() => vi.unstubAllGlobals());

describe("SessionLaneClient", () => {
  const base = { supabaseUrl: "https://x.supabase.co", supabaseAnonKey: "anon" };

  it("calls the RPC caller with the comment id, lane, confirm + token and returns true", async () => {
    const calls: Array<{ id: string; lane: string; confirm: boolean; token: string }> = [];
    const client = new SessionLaneClient({
      ...base,
      getAccessToken: () => "tok-123",
      rpc: async (id, lane, confirm, token) => {
        calls.push({ id, lane, confirm, token });
      },
    });
    expect(await client.setLane("c1", "in_review")).toBe(true);
    // confirmGuest defaults to true (the deliberate click is the acknowledgment)
    expect(calls).toEqual([{ id: "c1", lane: "in_review", confirm: true, token: "tok-123" }]);
  });

  it("threads an explicit confirmGuest through", async () => {
    let seen: boolean | undefined;
    const client = new SessionLaneClient({
      ...base,
      getAccessToken: () => "t",
      rpc: async (_id, _lane, confirm) => {
        seen = confirm;
      },
    });
    await client.setLane("c1", "ready_for_agent", false);
    expect(seen).toBe(false);
  });

  it("awaits an async getAccessToken (refresh-before-write)", async () => {
    let seen = "";
    const client = new SessionLaneClient({
      ...base,
      getAccessToken: async () => "fresh",
      rpc: async (_id, _lane, _confirm, token) => {
        seen = token;
      },
    });
    await client.setLane("c1", "backlog");
    expect(seen).toBe("fresh");
  });

  it("returns false when the RPC fails (best-effort — never breaks the overlay)", async () => {
    const client = new SessionLaneClient({
      ...base,
      getAccessToken: () => "t",
      rpc: async () => {
        throw new Error("set_comment_lane failed (403): send_to_agent_forbidden");
      },
    });
    expect(await client.setLane("c1", "ready_for_agent")).toBe(false);
  });

  it("returns false for an empty comment id without calling the RPC", async () => {
    const rpc = vi.fn();
    const client = new SessionLaneClient({ ...base, getAccessToken: () => "t", rpc });
    expect(await client.setLane("", "backlog")).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("requires a supabase url + anon key", () => {
    expect(
      () =>
        new SessionLaneClient({
          supabaseUrl: "",
          supabaseAnonKey: "anon",
          getAccessToken: () => "t",
        }),
    ).toThrow();
  });

  it("the default fetch-based caller posts to set_comment_lane with the lane args", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true }) as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    const client = new SessionLaneClient({ ...base, getAccessToken: () => "tok-abc" });
    expect(await client.setLane("c1", "ready_for_agent")).toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://x.supabase.co/rest/v1/rpc/set_comment_lane");
    expect((opts.headers as Record<string, string>).Authorization).toBe("Bearer tok-abc");
    expect(JSON.parse(opts.body as string)).toEqual({
      p_comment_id: "c1",
      p_lane: "ready_for_agent",
      p_confirm_guest: true,
    });
  });

  it("the default fetch-based caller returns false on a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 403, statusText: "Forbidden", text: async () => "no" }) as unknown as Response),
    );
    const client = new SessionLaneClient({ ...base, getAccessToken: () => "t" });
    expect(await client.setLane("c1", "ready_for_agent")).toBe(false);
  });
});
