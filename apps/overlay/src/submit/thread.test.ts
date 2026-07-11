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

  it("signs a captures path, building an absolute URL from the RELATIVE signedURL", async () => {
    const fetchMock = vi.fn(
      async () =>
        ({
          ok: true,
          json: async () => ({ signedURL: "/object/sign/captures/p/a.png?token=abc" }),
        }) as unknown as Response,
    );
    vi.stubGlobal("fetch", fetchMock);

    const url = await client().signCapture("p/a.png");
    expect(url).toBe(
      "https://x.supabase.co/storage/v1/object/sign/captures/p/a.png?token=abc",
    );
    const [reqUrl, opts] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(reqUrl).toBe("https://x.supabase.co/storage/v1/object/sign/captures/p/a.png");
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body as string)).toEqual({ expiresIn: 3600 });
    const headers = opts.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer jwt");
    expect(headers.apikey).toBe("anon");
  });

  it("returns null on a failed sign (never throws)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false }) as unknown as Response));
    expect(await client().signCapture("p/a.png")).toBeNull();
  });

  it("returns null when the sign response carries no signedURL", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({}) }) as unknown as Response),
    );
    expect(await client().signCapture("p/a.png")).toBeNull();
  });

  it("encodes each path segment (guest-controlled refs can't corrupt the URL)", async () => {
    const fetchMock = vi.fn(
      async () => ({ ok: true, json: async () => ({ signedURL: "/s?token=t" }) }) as unknown as Response,
    );
    vi.stubGlobal("fetch", fetchMock);
    // A '?' in a segment would otherwise start a query string on the sign URL.
    await client().signCapture("prev/a b?.png");
    const [reqUrl] = fetchMock.mock.calls[0] as unknown as [string];
    expect(reqUrl).toBe(
      "https://x.supabase.co/storage/v1/object/sign/captures/prev/a%20b%3F.png",
    );
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
      p_image_refs: [],
    });
  });

  it("passes attached image refs to create_review_reply (R19)", async () => {
    const fetchMock = vi.fn(
      async () => ({ ok: true, json: async () => ({ id: "r1" }) }) as unknown as Response,
    );
    vi.stubGlobal("fetch", fetchMock);

    await client().createReply("c1", "", ["prev/a.png", "prev/b.webp"]);
    const [, opts] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(opts.body as string)).toEqual({
      p_comment_id: "c1",
      p_body: "", // image-only reply: empty body, images carry it
      p_image_refs: ["prev/a.png", "prev/b.webp"],
    });
  });

  it("edits the author's own comment via edit_review_comment (note + images, 0050)", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true }) as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);
    expect(await client().editComment("c1", "new note", ["prev/a.png"])).toBe(true);
    const [url, opts] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/rest/v1/rpc/edit_review_comment");
    expect(JSON.parse(opts.body as string)).toEqual({
      p_comment_id: "c1",
      p_note: "new note",
      p_image_refs: ["prev/a.png"],
    });
  });

  it("lists replies selecting image_refs for display (R19)", async () => {
    const fetchMock = vi.fn(
      async () => ({ ok: true, json: async () => [] }) as unknown as Response,
    );
    vi.stubGlobal("fetch", fetchMock);
    await client().listReplies("c1");
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toContain("image_refs");
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
