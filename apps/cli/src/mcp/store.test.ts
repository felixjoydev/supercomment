import { describe, expect, it } from "vitest";
import type { McpComment } from "@supercomment/shared";
import {
  CAPTURE_SIGN_TTL_SECONDS,
  InMemoryCommentStore,
  MAX_RESOLVED_REFERENCE_IMAGES,
  MAX_RESOLVED_THREAD_IMAGES,
  SupabaseCommentStore,
  type SupabaseLike,
} from "./store.js";

const PREVIEW_ID = "00000000-0000-0000-0000-0000000000aa";

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    preview_id: PREVIEW_ID,
    number: 1,
    author_participant: "Reviewer",
    trust_level: "guest",
    intent: "fix",
    severity: "important",
    note: "n",
    path: "/page",
    context: { selector: "x", anchors: [], url: "https://x", consoleErrors: [] },
    status: "open",
    fidelity: "live",
    // Default to the agent's work queue so the default listOpenComments (U12,
    // lane=ready_for_agent) includes these rows; lane-specific tests override.
    lane: "ready_for_agent",
    is_stale: false,
    resolved_by: null,
    resolved_summary: null,
    created_at: "2026-05-30T00:00:00.000Z",
    ...overrides,
  };
}

function mcp(number: number, trust: "member" | "guest", status: McpComment["status"] = "open"): McpComment {
  return {
    id: `id-${number}`,
    previewId: PREVIEW_ID,
    number,
    author: { displayName: `a${number}`, trustLevel: trust },
    intent: "fix",
    severity: "important",
    note: "n",
    context: { selector: "x", anchors: [], url: "https://x", consoleErrors: [] },
    status,
    fidelity: "live",
    kind: "comment",
    lane: "ready_for_agent",
    isStale: false,
    createdAt: "2026-05-30T00:00:00.000Z",
    trustLevel: trust,
  };
}

describe("InMemoryCommentStore", () => {
  it("returns open comments ordered by number ascending regardless of seed order", async () => {
    const store = new InMemoryCommentStore([
      mcp(3, "member"),
      mcp(1, "guest"),
      mcp(2, "member"),
    ]);
    const all = await store.listOpenComments({ includeGuests: true });
    expect(all.map((c) => c.number)).toEqual([1, 2, 3]);
  });

  it("maps number to the right comment and updates status on resolve/dismiss", async () => {
    const store = new InMemoryCommentStore([mcp(1, "member"), mcp(2, "guest")]);
    const r = await store.resolveComment(1, "done");
    expect(r?.status).toBe("resolved");
    expect(r?.resolvedSummary).toBe("done");
    const d = await store.dismissComment(2, "nope");
    expect(d?.status).toBe("dismissed");
  });
});

// A tiny fake matching SupabaseLike that records calls. It implements just
// enough of the chained query builder used by SupabaseCommentStore.
function fakeClient(opts: {
  rows: Record<string, unknown>[];
  replies?: Record<string, unknown>[];
  prompts?: Record<string, unknown>[];
  /** Rows for `agent_reference_confirmations` — only `comment_id` matters. */
  confirmations?: Record<string, unknown>[];
  rpcSpy?: (fn: string, args: Record<string, unknown>) => void;
  /** Records every createSignedUrl call (bucket, path, expiresIn). */
  signSpy?: (bucket: string, path: string, expiresIn: number) => void;
  /**
   * Per-path signing outcome. A path mapped to a string succeeds with that
   * value as the "signed" URL; a path mapped to `null` simulates a signing
   * failure (`{ data: null, error }`). A path with NO entry here succeeds
   * with a deterministic `signed:<path>` default so most tests don't need to
   * wire this up at all.
   */
  signedUrls?: Record<string, string | null>;
}): SupabaseLike {
  const {
    rows,
    replies = [],
    prompts = [],
    confirmations = [],
    rpcSpy,
    signSpy,
    signedUrls = {},
  } = opts;
  return {
    from(table: string) {
      const source =
        table === "comment_replies"
          ? replies
          : table === "agent_prompts"
            ? prompts
            : table === "agent_reference_confirmations"
              ? confirmations
              : rows;
      return {
        select() {
          return {
            eq(_c1: string, _v1: unknown) {
              return {
                eq(c2: string, v2: unknown) {
                  return {
                    // Third .eq() = the lane filter (U12): the store adds
                    // .eq("lane", L) after .eq("status","open") for a specific
                    // lane. Filter open rows by that lane here.
                    eq(c3: string, v3: unknown) {
                      return {
                        order: async () => ({
                          data: source.filter(
                            (r) =>
                              r.status === "open" &&
                              (c3 === "lane" ? r.lane === v3 : true),
                          ),
                          error: null,
                        }),
                      };
                    },
                    order: async () => ({
                      data: source.filter((r) => r.status === "open"),
                      error: null,
                    }),
                    maybeSingle: async () => ({
                      // "comments" (.eq(preview_id).eq(number, N)) matches by
                      // number; agent_prompts/agent_reference_confirmations
                      // (.eq(preview_id).eq(comment_id, id), U7's getComment
                      // narrowing) match by comment_id — keyed on the actual
                      // column name the caller filtered on, not the table.
                      data:
                        source.find((r) =>
                          c2 === "comment_id" ? r.comment_id === v2 : r.number === v2,
                        ) ?? null,
                      error: null,
                    }),
                  };
                },
                // Single-.eq().order() — comment_replies by comment_id,
                // agent_prompts / agent_reference_confirmations by preview_id.
                order: async () => ({ data: source, error: null }),
              };
            },
            // Unfiltered select().order() (projects / previews listing).
            order: async () => ({ data: rows, error: null }),
          };
        },
      };
    },
    async rpc(fn: string, args: Record<string, unknown>) {
      rpcSpy?.(fn, args);
      return { data: null, error: null };
    },
    storage: {
      from(bucket: string) {
        return {
          async createSignedUrl(path: string, expiresIn: number) {
            signSpy?.(bucket, path, expiresIn);
            if (Object.prototype.hasOwnProperty.call(signedUrls, path)) {
              const url: string | null = signedUrls[path] ?? null;
              if (url === null) {
                return { data: null, error: { message: "sign failed" } };
              }
              return { data: { signedUrl: url }, error: null };
            }
            return { data: { signedUrl: `signed:${path}` }, error: null };
          },
        };
      },
    },
  };
}

describe("SupabaseCommentStore", () => {
  it("maps DB rows (snake_case) to the MCP comment shape with trustLevel surfaced", async () => {
    const client = fakeClient({ rows: [row({ number: 5, trust_level: "guest" })] });
    const store = new SupabaseCommentStore(client, PREVIEW_ID);
    const open = await store.listOpenComments();
    expect(open).toHaveLength(1);
    const first = open[0]!;
    expect(first.number).toBe(5);
    expect(first.trustLevel).toBe("guest");
    expect(first.author.trustLevel).toBe("guest");
    expect(first.previewId).toBe(PREVIEW_ID);
  });

  it("never leaks per-viewer unread or guest email to the agent (U13)", async () => {
    // Even if the underlying read-model row carries the per-viewer / guest-identity
    // fields (0036/0037), the agent-facing projection must drop them.
    const client = fakeClient({
      rows: [
        row({
          number: 9,
          unread: true,
          last_read_at: "2026-07-04T10:00:00.000Z",
          status_changed_at: "2026-07-04T10:00:00.000Z",
          email_ci: "client@example.com",
        }),
      ],
    });
    const store = new SupabaseCommentStore(client, PREVIEW_ID);
    const [c] = await store.listOpenComments({ includeGuests: true });
    const keys = Object.keys(c!);
    for (const leak of ["unread", "lastReadAt", "statusChangedAt", "email", "authorEmail"]) {
      expect(keys).not.toContain(leak);
    }
    expect(JSON.stringify(c)).not.toContain("client@example.com");
    // The agent still knows which page the comment is on, via context.url.
    expect(c!.context?.url).toBe("https://x");
  });

  it("redacts reviewer-authored free-text (note + change-set) at the agent boundary (U8)", async () => {
    const secret = "sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    const client = fakeClient({
      rows: [
        row({
          number: 7,
          note: `please rotate ${secret}`,
          context: {
            selector: "h1",
            anchors: [],
            url: "https://x",
            consoleErrors: [],
            changeSet: {
              ops: [
                {
                  opId: "o1",
                  type: "setText",
                  target: { selector: "h1", anchors: [] },
                  before: "Welcome",
                  after: `Contact ${secret}`,
                },
              ],
            },
          },
        }),
      ],
    });
    const store = new SupabaseCommentStore(client, PREVIEW_ID);
    const [c] = await store.listOpenComments({ includeGuests: true });
    expect(c!.note).not.toContain(secret);
    expect(c!.note).toContain("[redacted]");
    const op = c!.context?.changeSet?.ops[0];
    expect(op?.before).toBe("Welcome"); // non-secret free-text preserved
    expect(op?.after).not.toContain(secret);
    expect(op?.after).toContain("[redacted]");
  });

  it("listOpenComments attaches a live prompt (U6) via one batch-fetched query, unredacted", async () => {
    const client = fakeClient({
      rows: [row({ id: "c-1", number: 1 }), row({ id: "c-2", number: 2 })],
      prompts: [
        { comment_id: "c-1", body: "Match the Figma spec exactly.", author_display_name: "Priya" },
      ],
    });
    const store = new SupabaseCommentStore(client, PREVIEW_ID);
    const [c1, c2] = await store.listOpenComments({ includeGuests: true });
    expect(c1!.privatePrompt).toEqual({
      body: "Match the Figma spec exactly.",
      authorDisplayName: "Priya",
    });
    // A comment with no agent_prompts row carries no privatePrompt at all.
    expect(c2!.privatePrompt).toBeUndefined();
  });

  it("getComment attaches the same comment's live prompt", async () => {
    const client = fakeClient({
      rows: [row({ id: "c-9", number: 9 })],
      prompts: [
        { comment_id: "c-9", body: "Use the brand blue for the CTA.", author_display_name: "Priya" },
      ],
    });
    const store = new SupabaseCommentStore(client, PREVIEW_ID);
    const c = await store.getComment(9);
    expect(c?.privatePrompt).toEqual({
      body: "Use the brand blue for the CTA.",
      authorDisplayName: "Priya",
    });
  });

  it("never redacts a private prompt body, even when it contains a secret-looking string (unlike note)", async () => {
    const secret = "sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    const client = fakeClient({
      rows: [row({ id: "c-3", number: 3, note: `please rotate ${secret}` })],
      prompts: [
        { comment_id: "c-3", body: `Rotate the key ${secret} before shipping.`, author_display_name: "Priya" },
      ],
    });
    const store = new SupabaseCommentStore(client, PREVIEW_ID);
    const [c] = await store.listOpenComments({ includeGuests: true });
    // The note (untrusted reviewer free-text) IS redacted, unchanged behavior.
    expect(c!.note).toContain("[redacted]");
    // The private prompt (trusted-operator input) is delivered verbatim.
    expect(c!.privatePrompt?.body).toBe(`Rotate the key ${secret} before shipping.`);
    expect(c!.privatePrompt?.body).not.toContain("[redacted]");
  });

  it("treats a cleared (empty/whitespace) prompt row exactly like no prompt at all", async () => {
    const client = fakeClient({
      rows: [row({ id: "c-4", number: 4 })],
      prompts: [{ comment_id: "c-4", body: "   ", author_display_name: "Priya" }],
    });
    const store = new SupabaseCommentStore(client, PREVIEW_ID);
    const [c] = await store.listOpenComments({ includeGuests: true });
    expect(c!.privatePrompt).toBeUndefined();
  });

  it("getComment returns null for a missing number", async () => {
    const client = fakeClient({ rows: [row({ number: 1 })] });
    const store = new SupabaseCommentStore(client, PREVIEW_ID);
    expect(await store.getComment(42)).toBeNull();
  });

  it("getComment attaches the thread (replies in order); the last is decisive", async () => {
    const client = fakeClient({
      rows: [row({ number: 5 })],
      replies: [
        {
          author_display_name: "Client",
          trust_level: "guest",
          body: "make it blue",
          created_at: "2026-01-01T00:00:00Z",
        },
        {
          author_display_name: "dev@x.com",
          trust_level: "member",
          body: "actually green",
          created_at: "2026-01-02T00:00:00Z",
        },
      ],
    });
    const store = new SupabaseCommentStore(client, PREVIEW_ID);
    const c = await store.getComment(5);
    expect(c?.thread).toHaveLength(2);
    expect(c?.thread?.[0]?.author).toBe("Client");
    expect(c?.thread?.[1]?.body).toBe("actually green"); // last reply = decisive
  });

  it("getComment omits the thread when there are no replies", async () => {
    const client = fakeClient({ rows: [row({ number: 5 })], replies: [] });
    const store = new SupabaseCommentStore(client, PREVIEW_ID);
    expect((await store.getComment(5))?.thread).toBeUndefined();
  });

  it("getComment resolves the NEWEST thread reply images (recency), capped at MAX_RESOLVED_THREAD_IMAGES", async () => {
    const signCalls: string[] = [];
    const client = fakeClient({
      rows: [row({ number: 5, trust_level: "member" })],
      replies: [
        {
          author_display_name: "dev",
          trust_level: "member",
          body: "first",
          created_at: "2026-01-01T00:00:00Z",
          image_refs: ["prev/a.png", "prev/b.png"],
        },
        {
          author_display_name: "dev",
          trust_level: "member",
          body: "then",
          created_at: "2026-01-02T00:00:00Z",
          image_refs: ["prev/c.png", "prev/d.png"],
        },
      ],
      signSpy: (_b, path) => signCalls.push(path),
    });
    const store = new SupabaseCommentStore(client, PREVIEW_ID);
    const c = await store.getComment(5);
    // Only the newest 3 across the whole thread are signed; the oldest (a) stays raw.
    expect(signCalls).toHaveLength(MAX_RESOLVED_THREAD_IMAGES);
    expect(signCalls).not.toContain("prev/a.png");
    expect(new Set(signCalls)).toEqual(new Set(["prev/d.png", "prev/c.png", "prev/b.png"]));
    // The latest reply (current ask) is fully resolved.
    expect(c?.thread?.[1]?.imageRefs).toEqual(["signed:prev/c.png", "signed:prev/d.png"]);
    // Its predecessor keeps the over-cap oldest as a raw path, the newer signed.
    expect(c?.thread?.[0]?.imageRefs).toEqual(["prev/a.png", "signed:prev/b.png"]);
  });

  it("does NOT sign an UNCONFIRMED guest reply's images (gated like a guest raster, R11)", async () => {
    const signCalls: string[] = [];
    const client = fakeClient({
      rows: [row({ number: 6, trust_level: "guest" })],
      replies: [
        {
          author_display_name: "Client",
          trust_level: "guest",
          body: "like this",
          created_at: "2026-01-01T00:00:00Z",
          image_refs: ["prev/guest-reply.png"],
        },
      ],
      signSpy: (_b, path) => signCalls.push(path),
    });
    const store = new SupabaseCommentStore(client, PREVIEW_ID);
    const c = await store.getComment(6);
    expect(signCalls).toHaveLength(0); // withheld from resolution
    expect(c?.thread?.[0]?.imageRefs).toEqual(["prev/guest-reply.png"]); // raw
  });

  it("resolves a guest reply's images once the send is CONFIRMED (reply predates the confirm)", async () => {
    const client = fakeClient({
      rows: [row({ id: "c-conf", number: 7, trust_level: "guest" })],
      replies: [
        {
          author_display_name: "Client",
          trust_level: "guest",
          body: "like this",
          created_at: "2026-01-01T00:00:00Z",
          image_refs: ["prev/guest-reply.png"],
        },
      ],
      confirmations: [{ comment_id: "c-conf", confirmed_at: "2026-01-02T00:00:00Z" }],
    });
    const store = new SupabaseCommentStore(client, PREVIEW_ID);
    const c = await store.getComment(7);
    expect(c?.referenceConfirmed).toBe(true);
    expect(c?.thread?.[0]?.imageRefs).toEqual(["signed:prev/guest-reply.png"]);
  });

  it("WITHHOLDS a guest reply image APPENDED AFTER the confirm (recency gate, security)", async () => {
    const signCalls: string[] = [];
    const client = fakeClient({
      rows: [row({ id: "c-toctou", number: 11, trust_level: "guest" })],
      replies: [
        // A guest reply added AFTER the member confirmed the send — never reviewed.
        {
          author_display_name: "Client",
          trust_level: "guest",
          body: "sneaky",
          created_at: "2026-01-03T00:00:00Z",
          image_refs: ["prev/post-confirm.png"],
        },
      ],
      confirmations: [{ comment_id: "c-toctou", confirmed_at: "2026-01-02T00:00:00Z" }],
      signSpy: (_b, path) => signCalls.push(path),
    });
    const store = new SupabaseCommentStore(client, PREVIEW_ID);
    const c = await store.getComment(11);
    expect(c?.referenceConfirmed).toBe(true); // comment-level confirm still set
    expect(signCalls).toHaveLength(0); // but the later guest image is NOT signed
    expect(c?.thread?.[0]?.imageRefs).toEqual(["prev/post-confirm.png"]); // raw; forAgent strips
  });

  it("resolves a MEMBER reply's images even on an unconfirmed guest comment", async () => {
    const client = fakeClient({
      rows: [row({ number: 8, trust_level: "guest" })], // comment guest + unconfirmed
      replies: [
        {
          author_display_name: "dev",
          trust_level: "member",
          body: "do this",
          created_at: "2026-01-01T00:00:00Z",
          image_refs: ["prev/dev-reply.png"],
        },
      ],
    });
    const store = new SupabaseCommentStore(client, PREVIEW_ID);
    const c = await store.getComment(8);
    expect(c?.thread?.[0]?.imageRefs).toEqual(["signed:prev/dev-reply.png"]);
  });

  it("resolves a member prompt's images to signed URLs on getComment (TRUSTED, no gate)", async () => {
    const client = fakeClient({
      // Even on a GUEST comment, the member-authored prompt's images are trusted.
      rows: [row({ id: "c-p", number: 9, trust_level: "guest" })],
      prompts: [
        {
          comment_id: "c-p",
          body: "match this",
          author_display_name: "Ada",
          image_refs: ["prev/p1.png", "prev/p2.png"],
        },
      ],
    });
    const store = new SupabaseCommentStore(client, PREVIEW_ID);
    const c = await store.getComment(9);
    expect(c?.privatePrompt?.imageRefs).toEqual([
      "signed:prev/p1.png",
      "signed:prev/p2.png",
    ]);
  });

  it("keeps an IMAGE-ONLY prompt (empty body + images) as a real prompt", async () => {
    const client = fakeClient({
      rows: [row({ id: "c-io", number: 10 })],
      prompts: [
        {
          comment_id: "c-io",
          body: "",
          author_display_name: "Ada",
          image_refs: ["prev/only.png"],
        },
      ],
    });
    const store = new SupabaseCommentStore(client, PREVIEW_ID);
    const c = await store.getComment(10);
    expect(c?.privatePrompt?.body).toBe("");
    expect(c?.privatePrompt?.imageRefs).toEqual(["signed:prev/only.png"]);
  });

  // --- Uploaded fonts (U9) ---------------------------------------------------

  const FONT_UUID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const pinnedRef = (uuid = FONT_UUID) => `${PREVIEW_ID}/${uuid}.woff2`;

  function fontOp(opId: string, fileRef: string, family = "Grifter") {
    return {
      opId,
      type: "setStyle",
      target: { selector: "h1", anchors: [] },
      property: "font-family",
      after: `"${family}", sans-serif`,
      font: { family, source: "upload", fileRef },
    };
  }

  function fontContext(...ops: unknown[]) {
    return { selector: "h1", anchors: [], url: "https://x", consoleErrors: [], changeSet: { ops } };
  }

  it("signs a MEMBER comment's pinned uploaded font ref on getComment (U9)", async () => {
    const client = fakeClient({
      rows: [
        row({ number: 5, trust_level: "member", context: fontContext(fontOp("o1", pinnedRef())) }),
      ],
    });
    const store = new SupabaseCommentStore(client, PREVIEW_ID);
    const c = await store.getComment(5);
    const op = c?.context?.changeSet?.ops[0];
    expect(op?.font?.fileRef).toBe(`signed:${pinnedRef()}`);
    expect(op?.font?.family).toBe("Grifter"); // family preserved
  });

  it("DROPS (never signs) a font ref pinned to a DIFFERENT preview (U9 pin gate)", async () => {
    const foreign = `99999999-0000-4000-8000-000000000000/${FONT_UUID}.woff2`;
    const signCalls: string[] = [];
    const client = fakeClient({
      rows: [row({ number: 6, trust_level: "member", context: fontContext(fontOp("o1", foreign)) })],
      signSpy: (_b, p) => signCalls.push(p),
    });
    const store = new SupabaseCommentStore(client, PREVIEW_ID);
    const c = await store.getComment(6);
    const op = c?.context?.changeSet?.ops[0];
    expect(op?.font?.fileRef).toBeUndefined(); // stripped to family-only
    expect(op?.font?.family).toBe("Grifter");
    expect(signCalls).toHaveLength(0); // pin check fails before any Storage round trip
  });

  it("caps signed font refs at MAX_RESOLVED_FONT_REFS; over-cap ops keep the family only (U9)", async () => {
    const client = fakeClient({
      rows: [
        row({
          number: 7,
          trust_level: "member",
          context: fontContext(
            fontOp("o1", pinnedRef("aaaaaaaa-1111-4111-8111-111111111111"), "A"),
            fontOp("o2", pinnedRef("bbbbbbbb-2222-4222-8222-222222222222"), "B"),
            fontOp("o3", pinnedRef("cccccccc-3333-4333-8333-333333333333"), "C"),
          ),
        }),
      ],
    });
    const store = new SupabaseCommentStore(client, PREVIEW_ID);
    const c = await store.getComment(7);
    const ops = c!.context!.changeSet!.ops;
    expect(ops[0]?.font?.fileRef).toContain("signed:");
    expect(ops[1]?.font?.fileRef).toContain("signed:");
    expect(ops[2]?.font?.fileRef).toBeUndefined(); // over the cap -> family only
    expect(ops[2]?.font?.family).toBe("C");
  });

  it("does NOT sign an UNCONFIRMED guest's uploaded font ref (gated like a raster, U9)", async () => {
    const signCalls: string[] = [];
    const client = fakeClient({
      rows: [row({ number: 8, trust_level: "guest", context: fontContext(fontOp("o1", pinnedRef())) })],
      signSpy: (_b, p) => signCalls.push(p),
    });
    const store = new SupabaseCommentStore(client, PREVIEW_ID);
    const c = await store.getComment(8);
    expect(signCalls).toHaveLength(0); // never signed
    // Left raw here (forAgent strips it on delivery); crucially, not a signed URL.
    expect(c?.context?.changeSet?.ops[0]?.font?.fileRef).toBe(pinnedRef());
  });

  it("signs a CONFIRMED guest's uploaded font ref (U9)", async () => {
    const client = fakeClient({
      rows: [row({ id: "c-fc", number: 9, trust_level: "guest", context: fontContext(fontOp("o1", pinnedRef())) })],
      confirmations: [{ comment_id: "c-fc", confirmed_at: "2026-01-02T00:00:00Z" }],
    });
    const store = new SupabaseCommentStore(client, PREVIEW_ID);
    const c = await store.getComment(9);
    expect(c?.referenceConfirmed).toBe(true);
    expect(c?.context?.changeSet?.ops[0]?.font?.fileRef).toBe(`signed:${pinnedRef()}`);
  });

  it("resolveComment resolves number->id then calls the resolve_comment RPC with that id", async () => {
    const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
    const client = fakeClient({
      rows: [row({ number: 2, id: "the-id-2" })],
      rpcSpy: (fn, args) => calls.push({ fn, args }),
    });
    const store = new SupabaseCommentStore(client, PREVIEW_ID);
    await store.resolveComment(2, "fixed it");
    expect(calls).toEqual([
      { fn: "resolve_comment", args: { p_comment_id: "the-id-2", p_summary: "fixed it" } },
    ]);
  });

  it("dismissComment calls the dismiss_comment RPC with the resolved id + reason", async () => {
    const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
    const client = fakeClient({
      rows: [row({ number: 7, id: "the-id-7" })],
      rpcSpy: (fn, args) => calls.push({ fn, args }),
    });
    const store = new SupabaseCommentStore(client, PREVIEW_ID);
    await store.dismissComment(7, "won't fix");
    expect(calls).toEqual([
      { fn: "dismiss_comment", args: { p_comment_id: "the-id-7", p_reason: "won't fix" } },
    ]);
  });

  it("does not call the RPC when the number does not exist", async () => {
    const calls: Array<{ fn: string }> = [];
    const client = fakeClient({
      rows: [row({ number: 1 })],
      rpcSpy: (fn) => calls.push({ fn }),
    });
    const store = new SupabaseCommentStore(client, PREVIEW_ID);
    const r = await store.resolveComment(999);
    expect(r).toBeNull();
    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// U7 — reference/screenshot resolution + confirm gating (R10-R12, R18)
// ---------------------------------------------------------------------------

describe("SupabaseCommentStore — U7 reference resolution + confirm gating", () => {
  function ctxWithRaster(overrides: Record<string, unknown> = {}) {
    return {
      selector: "x",
      anchors: [],
      url: "https://x",
      consoleErrors: [],
      ...overrides,
    };
  }

  it("resolves a MEMBER's screenshot to a signed URL on getComment — no marker needed", async () => {
    const signCalls: Array<{ bucket: string; path: string; expiresIn: number }> = [];
    const client = fakeClient({
      rows: [
        row({
          number: 1,
          trust_level: "member",
          context: ctxWithRaster({ screenshot: "preview-1/shot.png" }),
        }),
      ],
      signSpy: (bucket, path, expiresIn) => signCalls.push({ bucket, path, expiresIn }),
    });
    const store = new SupabaseCommentStore(client, PREVIEW_ID);
    const c = await store.getComment(1);
    expect(c?.context?.screenshot).toBe("signed:preview-1/shot.png");
    expect(signCalls).toEqual([
      { bucket: "captures", path: "preview-1/shot.png", expiresIn: CAPTURE_SIGN_TTL_SECONDS },
    ]);
  });

  it("does NOT resolve (or even attempt to sign) an UNCONFIRMED guest's screenshot on getComment", async () => {
    const signCalls: string[] = [];
    const client = fakeClient({
      rows: [
        row({
          number: 2,
          trust_level: "guest",
          context: ctxWithRaster({ screenshot: "preview-1/guest-shot.png" }),
        }),
      ],
      signSpy: (_b, path) => signCalls.push(path),
    });
    const store = new SupabaseCommentStore(client, PREVIEW_ID);
    const c = await store.getComment(2);
    // Left exactly as stored -- raw, unsigned. tools.ts's forAgent (using the
    // SAME gating predicate) is what strips this for delivery.
    expect(c?.context?.screenshot).toBe("preview-1/guest-shot.png");
    expect(c?.referenceConfirmed).toBeUndefined();
    expect(signCalls).toHaveLength(0);
  });

  it("resolves a CONFIRMED guest's screenshot AND referenceImages on getComment", async () => {
    const client = fakeClient({
      rows: [
        row({
          id: "c-confirmed",
          number: 3,
          trust_level: "guest",
          context: ctxWithRaster({
            screenshot: "preview-1/confirmed-shot.png",
            referenceImages: ["preview-1/ref-a.png"],
          }),
        }),
      ],
      confirmations: [{ comment_id: "c-confirmed" }],
    });
    const store = new SupabaseCommentStore(client, PREVIEW_ID);
    const c = await store.getComment(3);
    expect(c?.referenceConfirmed).toBe(true);
    expect(c?.context?.screenshot).toBe("signed:preview-1/confirmed-shot.png");
    expect(c?.context?.referenceImages).toEqual(["signed:preview-1/ref-a.png"]);
  });

  it("listOpenComments NEVER signs, even for a confirmed guest reference (R18 hot list path)", async () => {
    const signCalls: string[] = [];
    const client = fakeClient({
      rows: [
        row({
          id: "c-list-confirmed",
          number: 4,
          trust_level: "guest",
          context: ctxWithRaster({ screenshot: "preview-1/list-shot.png" }),
        }),
      ],
      confirmations: [{ comment_id: "c-list-confirmed" }],
      signSpy: (_b, path) => signCalls.push(path),
    });
    const store = new SupabaseCommentStore(client, PREVIEW_ID);
    const [c] = await store.listOpenComments({ includeGuests: true });
    expect(c?.referenceConfirmed).toBe(true);
    // Raw, unsigned -- the list path never resolves, only marks the confirm.
    expect(c?.context?.screenshot).toBe("preview-1/list-shot.png");
    expect(signCalls).toHaveLength(0);
  });

  it("caps referenceImages resolution at MAX_RESOLVED_REFERENCE_IMAGES, latest-first", async () => {
    const signCalls: string[] = [];
    const client = fakeClient({
      rows: [
        row({
          number: 5,
          trust_level: "member",
          context: ctxWithRaster({
            referenceImages: ["r1.png", "r2.png", "r3.png", "r4.png", "r5.png"],
          }),
        }),
      ],
      signSpy: (_b, path) => signCalls.push(path),
    });
    const store = new SupabaseCommentStore(client, PREVIEW_ID);
    const c = await store.getComment(5);
    // Only the latest MAX_RESOLVED_REFERENCE_IMAGES are ever attempted --
    // r1/r2/r3 are superseded and never even reach the signer.
    expect(signCalls).toEqual(["r5.png", "r4.png"]);
    expect(signCalls).toHaveLength(MAX_RESOLVED_REFERENCE_IMAGES);
    expect(c?.context?.referenceImages).toEqual(["signed:r5.png", "signed:r4.png"]);
  });

  it("degrades gracefully on a signing failure: never throws, keeps the raw value in place", async () => {
    const client = fakeClient({
      rows: [
        row({
          number: 6,
          trust_level: "member",
          context: ctxWithRaster({ screenshot: "preview-1/broken.png" }),
        }),
      ],
      signedUrls: { "preview-1/broken.png": null },
    });
    const store = new SupabaseCommentStore(client, PREVIEW_ID);
    const c = await store.getComment(6);
    // The read succeeded (no throw) and the raw value is still present so its
    // EXISTENCE remains visible to the agent-facing signals inventory, even
    // though it never turned into a viewable URL this time.
    expect(c?.context?.screenshot).toBe("preview-1/broken.png");
  });

  it("a data: image URL passes through unchanged, never sent to the signer", async () => {
    const signCalls: string[] = [];
    const client = fakeClient({
      rows: [
        row({
          number: 7,
          trust_level: "member",
          context: ctxWithRaster({ screenshot: "data:image/png;base64,AAA=" }),
        }),
      ],
      signSpy: (_b, path) => signCalls.push(path),
    });
    const store = new SupabaseCommentStore(client, PREVIEW_ID);
    const c = await store.getComment(7);
    expect(c?.context?.screenshot).toBe("data:image/png;base64,AAA=");
    expect(signCalls).toHaveLength(0);
  });
});
