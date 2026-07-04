import { describe, it, expect } from "vitest";
import { isThreadUnread } from "./unread.js";

const T0 = "2026-07-04T10:00:00.000Z";
const T1 = "2026-07-04T11:00:00.000Z";
const T2 = "2026-07-04T12:00:00.000Z";

describe("isThreadUnread", () => {
  it("is unread when there is no receipt", () => {
    expect(isThreadUnread({ createdAt: T0, lastReadAt: null })).toBe(true);
    expect(isThreadUnread({ createdAt: T0 })).toBe(true);
  });

  it("is read when the receipt is at or after all activity", () => {
    expect(isThreadUnread({ createdAt: T0, lastReadAt: T0 })).toBe(false);
    expect(isThreadUnread({ createdAt: T0, lastReadAt: T2 })).toBe(false);
  });

  it("re-flags unread when a newer reply arrives", () => {
    expect(
      isThreadUnread({ createdAt: T0, lastReadAt: T1, latestReplyAt: T2 }),
    ).toBe(true);
    expect(
      isThreadUnread({ createdAt: T0, lastReadAt: T2, latestReplyAt: T1 }),
    ).toBe(false);
  });

  it("re-flags unread when the status changed after the receipt (reopen)", () => {
    expect(
      isThreadUnread({ createdAt: T0, lastReadAt: T1, statusChangedAt: T2 }),
    ).toBe(true);
  });

  it("ignores unparseable timestamps rather than throwing", () => {
    expect(
      isThreadUnread({ createdAt: T0, lastReadAt: T2, latestReplyAt: "nope" }),
    ).toBe(false);
    expect(isThreadUnread({ createdAt: T0, lastReadAt: "nope" })).toBe(true);
  });
});
