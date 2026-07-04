import { describe, expect, it } from "vitest";
import type { McpComment } from "@supercomment/shared";
import {
  InMemoryCommentStore,
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
  rpcSpy?: (fn: string, args: Record<string, unknown>) => void;
}): SupabaseLike {
  const { rows, replies = [], rpcSpy } = opts;
  return {
    from(table: string) {
      const source = table === "comment_replies" ? replies : rows;
      return {
        select() {
          return {
            eq(_c1: string, _v1: unknown) {
              return {
                eq(_c2: string, v2: unknown) {
                  return {
                    order: async () => ({
                      data: source.filter((r) => r.status === "open"),
                      error: null,
                    }),
                    maybeSingle: async () => ({
                      data: source.find((r) => r.number === v2) ?? null,
                      error: null,
                    }),
                  };
                },
                // Single-.eq().order() — comment_replies by comment_id.
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
