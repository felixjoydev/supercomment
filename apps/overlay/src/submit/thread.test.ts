import { describe, it, expect, vi, afterEach } from "vitest";

import { SessionThreadClient } from "./thread.js";

function client() {
  return new SessionThreadClient({
    supabaseUrl: "https://x.supabase.co/",
    supabaseAnonKey: "anon",
    getAccessToken: () => "jwt",
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("SessionThreadClient", () => {
  it("lists replies via a session-scoped GET", async () => {
    const rows = [
      {
        id: "r1",
        author_display_name: "Ada",
        trust_level: "guest",
        body: "hi",
        created_at: "",
      },
    ];
    const fetchMock = vi.fn(
      async () => ({ ok: true, json: async () => rows }) as unknown as Response,
    );
    vi.stubGlobal("fetch", fetchMock);

    expect(await client().listReplies("c1")).toEqual(rows);
    const [url, opts] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/rest/v1/comment_replies?comment_id=eq.c1");
    expect(url).toContain("order=created_at.asc");
    expect((opts.headers as Record<string, string>).Authorization).toBe("Bearer jwt");
  });

  it("returns [] on a failed list (never throws)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false }) as unknown as Response));
    expect(await client().listReplies("c1")).toEqual([]);
  });

  it("creates a reply via the RPC and returns the row", async () => {
    const row = {
      id: "r1",
      author_display_name: "Ada",
      trust_level: "member",
      body: "yo",
      created_at: "",
    };
    const fetchMock = vi.fn(
      async () => ({ ok: true, json: async () => row }) as unknown as Response,
    );
    vi.stubGlobal("fetch", fetchMock);

    expect(await client().createReply("c1", "yo")).toEqual(row);
    const [url, opts] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/rest/v1/rpc/create_review_reply");
    expect(JSON.parse(opts.body as string)).toEqual({
      p_comment_id: "c1",
      p_body: "yo",
    });
  });

  it("resolve / deleteReply / deleteThread report success as a boolean", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true }) as unknown as Response));
    const c = client();
    expect(await c.resolve("c1", true)).toBe(true);
    expect(await c.deleteReply("r1")).toBe(true);
    expect(await c.deleteThread("c1")).toBe(true);

    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false }) as unknown as Response));
    expect(await c.resolve("c1", true)).toBe(false);
    expect(await c.deleteThread("c1")).toBe(false);
  });

  it("never throws — a network error resolves to a safe default", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("net down");
      }),
    );
    const c = client();
    expect(await c.listReplies("c1")).toEqual([]);
    expect(await c.createReply("c1", "x")).toBeNull();
    expect(await c.resolve("c1", true)).toBe(false);
  });
});
