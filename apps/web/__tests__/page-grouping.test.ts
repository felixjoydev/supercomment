import { describe, it, expect } from "vitest";
import {
  groupByPage,
  reconcileUnread,
  filterUnread,
  countUnread,
} from "../lib/comments/view";
import type { CommentView } from "../lib/comments/types";

function mk(over: Partial<CommentView>): CommentView {
  return {
    id: over.id ?? "c1",
    previewId: "p1",
    number: over.number ?? 1,
    author: null,
    authorParticipant: null,
    trustLevel: "guest",
    intent: "fix",
    severity: "minor",
    note: "n",
    status: "open",
    fidelity: "live",
    kind: "comment",
    isStale: false,
    context: null,
    path: null,
    resolvedSummary: null,
    createdAt: over.createdAt ?? "2026-07-04T10:00:00.000Z",
    statusChangedAt: over.statusChangedAt ?? "2026-07-04T10:00:00.000Z",
    sendStatus: null,
    pageKey: over.pageKey ?? "/",
    pageLabel: over.pageLabel ?? "Home",
    authorEmail: null,
    latestReplyAt: over.latestReplyAt ?? null,
    lastReadAt: over.lastReadAt ?? null,
    unread: over.unread ?? false,
    privatePrompt: over.privatePrompt ?? null,
    ...over,
  };
}

describe("groupByPage", () => {
  it("groups by page key with per-group counts + unread rollup", () => {
    const groups = groupByPage([
      mk({ id: "a", pageKey: "/", pageLabel: "Home", unread: false }),
      mk({ id: "b", pageKey: "/pricing", pageLabel: "/pricing", unread: true }),
      mk({ id: "c", pageKey: "/pricing", pageLabel: "/pricing", unread: false }),
    ]);
    const pricing = groups.find((g) => g.key === "/pricing")!;
    expect(pricing.count).toBe(2);
    expect(pricing.unreadCount).toBe(1);
    expect(pricing.hasUnread).toBe(true);
  });

  it("orders pages with unread first, then alphabetically, Other last", () => {
    const groups = groupByPage([
      mk({ id: "a", pageKey: "/zebra", pageLabel: "/zebra", unread: false }),
      mk({ id: "b", pageKey: "/alpha", pageLabel: "/alpha", unread: false }),
      mk({ id: "c", pageKey: "/needs", pageLabel: "/needs", unread: true }),
      mk({ id: "d", pageKey: " unknown-page", pageLabel: "Other", unread: true }),
    ]);
    expect(groups.map((g) => g.key)).toEqual([
      "/needs", // unread first
      "/alpha", // then alphabetical
      "/zebra",
      " unknown-page", // Other always last, even though it has unread
    ]);
  });
});

describe("reconcileUnread", () => {
  it("preserves the viewer's receipt and recomputes unread on a realtime update", () => {
    const existing = mk({
      id: "a",
      lastReadAt: "2026-07-04T12:00:00.000Z",
      unread: false,
    });
    // A broadcast re-projection carries no receipt (lastReadAt null) and would
    // otherwise flip unread true; reconcile must keep it read.
    const incoming = mk({ id: "a", lastReadAt: null, unread: true });
    const merged = reconcileUnread(existing, incoming);
    expect(merged.lastReadAt).toBe("2026-07-04T12:00:00.000Z");
    expect(merged.unread).toBe(false);
  });

  it("re-flags unread when the incoming activity is newer than the receipt", () => {
    const existing = mk({ id: "a", lastReadAt: "2026-07-04T11:00:00.000Z" });
    const incoming = mk({
      id: "a",
      lastReadAt: null,
      statusChangedAt: "2026-07-04T13:00:00.000Z", // reopened after the receipt
    });
    expect(reconcileUnread(existing, incoming).unread).toBe(true);
  });

  it("carries forward sendStatus and privatePrompt, which the raw broadcast row never carries", () => {
    const existing = mk({
      id: "a",
      sendStatus: "pending",
      privatePrompt: { body: "check the spacing", authorDisplayName: "Alice", imageRefs: [] },
    });
    // A freshly broadcast row (via toCommentView) always defaults these to
    // null since neither has a join on the raw comments row.
    const incoming = mk({ id: "a", sendStatus: null, privatePrompt: null });
    const merged = reconcileUnread(existing, incoming);
    expect(merged.sendStatus).toBe("pending");
    expect(merged.privatePrompt).toEqual({
      body: "check the spacing",
      authorDisplayName: "Alice",
      imageRefs: [],
    });
  });

  it("prefers the incoming sendStatus/privatePrompt when the broadcast actually carries one", () => {
    const existing = mk({
      id: "a",
      sendStatus: "pending",
      privatePrompt: { body: "old prompt", authorDisplayName: "Alice", imageRefs: [] },
    });
    const incoming = mk({
      id: "a",
      sendStatus: "done",
      privatePrompt: { body: "new prompt", authorDisplayName: "Bob", imageRefs: [] },
    });
    const merged = reconcileUnread(existing, incoming);
    expect(merged.sendStatus).toBe("done");
    expect(merged.privatePrompt).toEqual({
      body: "new prompt",
      authorDisplayName: "Bob",
      imageRefs: [],
    });
  });
});

describe("filterUnread + countUnread", () => {
  const list = [mk({ id: "a", unread: true }), mk({ id: "b", unread: false })];
  it("filters to unread only when asked", () => {
    expect(filterUnread(list, true).map((c) => c.id)).toEqual(["a"]);
    expect(filterUnread(list, false)).toHaveLength(2);
  });
  it("counts unread", () => {
    expect(countUnread(list)).toBe(1);
  });
});
