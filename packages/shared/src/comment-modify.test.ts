import { describe, expect, it } from "vitest";

import { commentModifyGate, modifyLockLabel } from "./comment-modify.js";

const base = { isOwn: true, status: "open", hasReplies: false, isSent: false };

describe("commentModifyGate", () => {
  it("allows the author to modify an untouched own comment", () => {
    expect(commentModifyGate(base)).toEqual({ canModify: true, lockReason: null });
  });

  it("never allows modifying someone else's comment (no lock reason to show)", () => {
    expect(commentModifyGate({ ...base, isOwn: false })).toEqual({
      canModify: false,
      lockReason: null,
    });
  });

  it("locks (closed) a resolved or dismissed own comment", () => {
    expect(commentModifyGate({ ...base, status: "resolved" }).lockReason).toBe("closed");
    expect(commentModifyGate({ ...base, status: "dismissed" }).lockReason).toBe("closed");
  });

  it("locks (sent) once the comment was sent to the agent", () => {
    expect(commentModifyGate({ ...base, isSent: true })).toEqual({
      canModify: false,
      lockReason: "sent",
    });
  });

  it("locks (replied) once someone has replied", () => {
    expect(commentModifyGate({ ...base, hasReplies: true })).toEqual({
      canModify: false,
      lockReason: "replied",
    });
  });

  it("prioritizes closed > sent > replied when several apply", () => {
    expect(
      commentModifyGate({ isOwn: true, status: "resolved", hasReplies: true, isSent: true })
        .lockReason,
    ).toBe("closed");
    expect(
      commentModifyGate({ isOwn: true, status: "open", hasReplies: true, isSent: true })
        .lockReason,
    ).toBe("sent");
  });

  it("gives a human label for each lock reason and empty for none", () => {
    expect(modifyLockLabel("sent")).toMatch(/agent/i);
    expect(modifyLockLabel("replied")).toMatch(/repl/i);
    expect(modifyLockLabel("closed")).toMatch(/closed/i);
    expect(modifyLockLabel(null)).toBe("");
  });
});
