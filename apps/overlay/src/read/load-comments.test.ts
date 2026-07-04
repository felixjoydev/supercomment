import { describe, expect, it, vi } from "vitest";

import {
  filterCommentsForPage,
  loadReviewComments,
  makeFetchListRpcCaller,
  toExistingMarkers,
  type ListReviewCommentsArgs,
  type ListRpcCaller,
  type RawReviewCommentRow,
  type ReviewComment,
} from "./load-comments.js";

const BASE = {
  supabaseUrl: "https://x.supabase.co",
  supabaseAnonKey: "anon-key",
  previewId: "00000000-0000-0000-0000-000000000123",
};

const ROWS: RawReviewCommentRow[] = [
  {
    id: "cmt-1",
    number: 1,
    intent: "fix",
    severity: "important",
    note: "Button is misaligned",
    status: "open",
    is_stale: false,
    context: { boundingBox: { x: 10, y: 20, width: 100, height: 40 } },
    created_at: "2026-06-29T00:00:00Z",
    display_name: "Ada",
  },
  {
    id: "cmt-2",
    number: 2,
    intent: "change",
    severity: "minor",
    note: "Tighten copy",
    status: "resolved",
    is_stale: true,
    context: {},
    created_at: "2026-06-29T01:00:00Z",
    display_name: "Grace",
  },
];

describe("loadReviewComments — arg shaping", () => {
  it("calls list_review_comments with the preview id and the session JWT", async () => {
    const rpc = vi.fn<ListRpcCaller>(async () => []);
    await loadReviewComments({
      ...BASE,
      getAccessToken: () => "session-jwt",
      rpc,
    });

    expect(rpc).toHaveBeenCalledTimes(1);
    const expectedArgs: ListReviewCommentsArgs = { p_preview_id: BASE.previewId };
    expect(rpc).toHaveBeenCalledWith(
      "list_review_comments",
      expectedArgs,
      "session-jwt",
    );
  });

  it("awaits an async access-token provider (refresh-before-read)", async () => {
    const getAccessToken = vi.fn(async () => "refreshed-jwt");
    const rpc = vi.fn<ListRpcCaller>(async () => []);
    await loadReviewComments({ ...BASE, getAccessToken, rpc });

    expect(getAccessToken).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      "list_review_comments",
      expect.any(Object),
      "refreshed-jwt",
    );
  });

  it("throws when constructed without a previewId", async () => {
    await expect(
      loadReviewComments({
        ...BASE,
        previewId: "",
        getAccessToken: () => "jwt",
        rpc: async () => [],
      }),
    ).rejects.toThrow(/previewId/i);
  });
});

describe("loadReviewComments — response mapping", () => {
  it("maps snake_case rows to typed ReviewComment[]", async () => {
    const comments = await loadReviewComments({
      ...BASE,
      getAccessToken: () => "jwt",
      rpc: async () => ROWS,
    });

    expect(comments).toHaveLength(2);
    expect(comments[0]).toEqual({
      id: "cmt-1",
      number: 1,
      intent: "fix",
      severity: "important",
      note: "Button is misaligned",
      status: "open",
      isStale: false,
      context: { boundingBox: { x: 10, y: 20, width: 100, height: 40 } },
      createdAt: "2026-06-29T00:00:00Z",
      authorDisplayName: "Ada",
    });
    // is_stale -> isStale, created_at -> createdAt, display_name -> authorDisplayName
    expect(comments[1]!.isStale).toBe(true);
    expect(comments[1]!.createdAt).toBe("2026-06-29T01:00:00Z");
    expect(comments[1]!.authorDisplayName).toBe("Grace");
  });

  it("returns an empty list when there are no comments (clean empty render)", async () => {
    const comments = await loadReviewComments({
      ...BASE,
      getAccessToken: () => "jwt",
      rpc: async () => [],
    });
    expect(comments).toEqual([]);
  });

  it("skips malformed rows that lack a numeric number", async () => {
    const comments = await loadReviewComments({
      ...BASE,
      getAccessToken: () => "jwt",
      rpc: async () => [{ note: "no number" }, { number: 5, note: "ok" }],
    });
    expect(comments.map((c) => c.number)).toEqual([5]);
  });

  it("propagates RPC errors (caller fails closed)", async () => {
    await expect(
      loadReviewComments({
        ...BASE,
        getAccessToken: () => "jwt",
        rpc: async () => {
          throw new Error("no_review_session");
        },
      }),
    ).rejects.toThrow("no_review_session");
  });
});

describe("makeFetchListRpcCaller — bearer + URL shaping", () => {
  it("POSTs to the rpc URL with the session JWT bearer and the anon apikey", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ROWS,
    })) as unknown as typeof fetch;

    const rpc = makeFetchListRpcCaller(
      BASE.supabaseUrl,
      BASE.supabaseAnonKey,
      fetchImpl,
    );
    const rows = await rpc(
      "list_review_comments",
      { p_preview_id: BASE.previewId },
      "session-jwt",
    );

    expect(rows).toEqual(ROWS);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0]!;
    expect(url).toBe("https://x.supabase.co/rest/v1/rpc/list_review_comments");
    expect(init.method).toBe("POST");
    // Bearer is the SESSION JWT, not the anon key; apikey is the anon key.
    expect(init.headers.Authorization).toBe("Bearer session-jwt");
    expect(init.headers.apikey).toBe(BASE.supabaseAnonKey);
    expect(JSON.parse(init.body)).toEqual({ p_preview_id: BASE.previewId });
  });

  it("throws with the status + body on a non-ok response (error path)", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: async () => "no_review_session",
    })) as unknown as typeof fetch;

    const rpc = makeFetchListRpcCaller(
      BASE.supabaseUrl,
      BASE.supabaseAnonKey,
      fetchImpl,
    );
    await expect(
      rpc("list_review_comments", { p_preview_id: BASE.previewId }, "jwt"),
    ).rejects.toThrow(/401.*no_review_session/);
  });
});

describe("filterCommentsForPage (per-page marker scoping)", () => {
  const commentOn = (number: number, url: string): ReviewComment => ({
    id: String(number),
    number,
    intent: "fix",
    severity: "minor",
    note: "n",
    status: "open",
    isStale: false,
    context: { url },
    createdAt: "2026-07-04T00:00:00Z",
    authorDisplayName: "Ada",
  });
  const home = commentOn(1, "https://felixjoy.me/");
  const supergoal = commentOn(2, "https://felixjoy.me/supergoal");
  const all = [home, supergoal];

  it("keeps only comments whose page path matches the current page", () => {
    expect(filterCommentsForPage(all, "https://felixjoy.me/")).toEqual([home]);
    expect(filterCommentsForPage(all, "https://felixjoy.me/supergoal")).toEqual([
      supergoal,
    ]);
  });

  it("ignores query + hash and normalizes a trailing slash", () => {
    expect(
      filterCommentsForPage(all, "https://felixjoy.me/supergoal?ref=x#top"),
    ).toEqual([supergoal]);
    expect(
      filterCommentsForPage([supergoal], "https://felixjoy.me/supergoal/"),
    ).toEqual([supergoal]);
    expect(
      filterCommentsForPage(
        [commentOn(3, "https://felixjoy.me/p/")],
        "https://felixjoy.me/p",
      ),
    ).toHaveLength(1);
  });

  it("keeps a comment whose URL is missing/unparseable (never silently drops)", () => {
    const noUrl = commentOn(4, "");
    noUrl.context = {}; // no url captured at all
    expect(filterCommentsForPage([noUrl], "https://felixjoy.me/")).toEqual([
      noUrl,
    ]);
  });
});

describe("toExistingMarkers", () => {
  it("projects comments to markers, pulling rect from context.boundingBox", () => {
    const comments: ReviewComment[] = [
      {
        id: "c1",
        number: 1,
        intent: "fix",
        severity: "minor",
        note: "n",
        status: "open",
        isStale: false,
        context: { boundingBox: { x: 10, y: 20, width: 100, height: 40 } },
        createdAt: "",
        authorDisplayName: "Ada",
      },
      {
        id: "c2",
        number: 2,
        intent: "fix",
        severity: "minor",
        note: "n",
        status: "open",
        isStale: true,
        context: {},
        createdAt: "",
        authorDisplayName: "Grace",
      },
    ];

    const markers = toExistingMarkers(comments);
    expect(markers).toEqual([
      {
        number: 1,
        rect: { x: 10, y: 20, width: 100, height: 40 },
        isStale: false,
        anchors: [],
        content: {
          id: "c1",
          note: "n",
          authorDisplayName: "Ada",
          intent: "fix",
          severity: "minor",
          status: "open",
          createdAt: "",
        },
      },
      {
        number: 2,
        rect: null,
        isStale: true,
        anchors: [],
        content: {
          id: "c2",
          note: "n",
          authorDisplayName: "Grace",
          intent: "fix",
          severity: "minor",
          status: "open",
          createdAt: "",
        },
      },
    ]);
    // The popover content rides along: note + author are carried per comment.
    expect(markers[0]!.content.note).toBe("n");
    expect(markers[0]!.content.authorDisplayName).toBe("Ada");
    expect(markers[1]!.content.authorDisplayName).toBe("Grace");
  });

  it("carries the captured anchors through for the U8 re-anchor pass", () => {
    const markers = toExistingMarkers([
      {
        id: "c1",
        number: 1,
        intent: "fix",
        severity: "minor",
        note: "n",
        status: "open",
        isStale: false,
        context: {
          anchors: [
            { type: "id", value: "save" },
            { type: "role", value: "button" },
            { type: "bogus" }, // malformed (no value) — dropped
          ],
        },
        createdAt: "",
        authorDisplayName: "Ada",
      },
    ]);
    expect(markers[0]!.anchors).toEqual([
      { type: "id", value: "save" },
      { type: "role", value: "button" },
    ]);
  });

  it("yields a null rect for a context with a malformed boundingBox", () => {
    const markers = toExistingMarkers([
      {
        id: "c9",
        number: 9,
        intent: "fix",
        severity: "minor",
        note: "n",
        status: "open",
        isStale: false,
        context: { boundingBox: { x: "nope" } as unknown },
        createdAt: "",
        authorDisplayName: "X",
      } as ReviewComment,
    ]);
    expect(markers[0]!.rect).toBeNull();
  });
});
