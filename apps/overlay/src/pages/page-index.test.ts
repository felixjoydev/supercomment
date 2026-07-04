import { describe, it, expect } from "vitest";
import { UNKNOWN_PAGE_KEY } from "@supercomment/shared";
import { groupPagesForIndex, type PageEntry } from "./page-index.js";
import type { ReviewComment } from "../read/load-comments.js";

function c(over: Partial<ReviewComment> & { url?: string }): ReviewComment {
  const { url, ...rest } = over;
  return {
    id: rest.id ?? "c1",
    number: rest.number ?? 1,
    intent: "fix",
    severity: "minor",
    note: "n",
    status: "open",
    isStale: false,
    context: url !== undefined ? { url } : {},
    createdAt: "2026-07-04T00:00:00Z",
    authorDisplayName: "Ada",
    path: null,
    unread: rest.unread ?? false,
    latestReplyAt: null,
    lastReadAt: null,
    ...rest,
  } as ReviewComment;
}

const keys = (entries: PageEntry[]) => entries.map((e) => e.key);

describe("groupPagesForIndex", () => {
  it("groups by page, counting comments + unread, folding query/hash", () => {
    const entries = groupPagesForIndex(
      [
        c({ id: "a", url: "https://x.dev/pricing", unread: true }),
        c({ id: "b", url: "https://x.dev/pricing?ref=1", unread: false }),
        c({ id: "d", url: "https://x.dev/", unread: false }),
      ],
      "https://x.dev/other",
    );
    const pricing = entries.find((e) => e.key === "/pricing")!;
    expect(pricing.count).toBe(2);
    expect(pricing.unreadCount).toBe(1);
    expect(pricing.hasUnread).toBe(true);
    expect(pricing.path).toBe("/pricing");
  });

  it("puts the current page first, then unread, then alpha, Other last", () => {
    const entries = groupPagesForIndex(
      [
        c({ id: "a", url: "https://x.dev/zebra" }),
        c({ id: "b", url: "https://x.dev/alpha", unread: true }),
        c({ id: "c", url: "https://x.dev/here" }),
        c({ id: "d", url: "" }), // unparseable -> Other
      ],
      "https://x.dev/here",
    );
    expect(keys(entries)).toEqual(["/here", "/alpha", "/zebra", UNKNOWN_PAGE_KEY]);
    expect(entries[0]!.isCurrent).toBe(true);
    expect(entries[3]!.path).toBeNull();
  });

  it("marks the current page even when it has unread elsewhere", () => {
    const entries = groupPagesForIndex(
      [c({ url: "https://x.dev/a" })],
      "https://x.dev/a",
    );
    expect(entries[0]!.isCurrent).toBe(true);
  });
});
