import { describe, it, expect, vi, afterEach } from "vitest";

import { SessionAgentPromptWriter } from "./agent-prompt.js";

afterEach(() => vi.unstubAllGlobals());

describe("SessionAgentPromptWriter", () => {
  const base = { supabaseUrl: "https://x.supabase.co", supabaseAnonKey: "anon" };

  it("calls set_agent_prompt with the comment id + body + current token and returns true", async () => {
    const calls: Array<{ id: string; body: string; token: string }> = [];
    const writer = new SessionAgentPromptWriter({
      ...base,
      getAccessToken: () => "tok-123",
      rpc: async (id, body, token) => {
        calls.push({ id, body, token });
      },
    });
    expect(await writer.write("c1", "Make it pop")).toBe(true);
    expect(calls).toEqual([{ id: "c1", body: "Make it pop", token: "tok-123" }]);
  });

  it("awaits an async getAccessToken (refresh-before-write)", async () => {
    let seen = "";
    const writer = new SessionAgentPromptWriter({
      ...base,
      getAccessToken: async () => "fresh",
      rpc: async (_id, _body, token) => {
        seen = token;
      },
    });
    await writer.write("c1", "text");
    expect(seen).toBe("fresh");
  });

  it("returns false when the RPC fails (best-effort — never breaks the save)", async () => {
    const writer = new SessionAgentPromptWriter({
      ...base,
      getAccessToken: () => "t",
      rpc: async () => {
        throw new Error("set_agent_prompt failed (403): not_authorized");
      },
    });
    expect(await writer.write("c1", "text")).toBe(false);
  });

  it("returns false for an empty comment id without calling the RPC", async () => {
    const rpc = vi.fn();
    const writer = new SessionAgentPromptWriter({ ...base, getAccessToken: () => "t", rpc });
    expect(await writer.write("", "text")).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("requires a supabase url + anon key", () => {
    expect(
      () =>
        new SessionAgentPromptWriter({
          supabaseUrl: "",
          supabaseAnonKey: "anon",
          getAccessToken: () => "t",
        }),
    ).toThrow();
  });

  // With no injected `rpc`, the real fetch-based caller hits set_agent_prompt
  // with the PostgREST arg names the 0043 RPC declares (p_comment_id/p_body).
  it("the default fetch-based RPC caller posts to set_agent_prompt with p_comment_id/p_body", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true }) as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    const writer = new SessionAgentPromptWriter({ ...base, getAccessToken: () => "tok-abc" });
    expect(await writer.write("c1", "Make it pop")).toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://x.supabase.co/rest/v1/rpc/set_agent_prompt");
    expect((opts.headers as Record<string, string>).Authorization).toBe("Bearer tok-abc");
    expect(JSON.parse(opts.body as string)).toEqual({
      p_comment_id: "c1",
      p_body: "Make it pop",
    });
  });

  it("the default fetch-based RPC caller returns false (via write) on a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          ({
            ok: false,
            status: 403,
            statusText: "Forbidden",
            text: async () => "not_authorized",
          }) as unknown as Response,
      ),
    );
    const writer = new SessionAgentPromptWriter({ ...base, getAccessToken: () => "t" });
    expect(await writer.write("c1", "text")).toBe(false);
  });
});
