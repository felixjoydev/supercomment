import { describe, it, expect } from "vitest";
import {
  normalizeCommentRow,
  coerceCommentContext,
  commentRowSchema,
  COMMENT_ROW_COLUMNS,
  withPrivateExtras,
  type CommentRow,
} from "./comment-row.js";

const baseRow: CommentRow = {
  id: "c1",
  preview_id: "p1",
  number: 3,
  author_participant: "part-1",
  trust_level: "member",
  intent: "fix",
  severity: "important",
  note: "please fix",
  status: "open",
  created_at: "2026-07-03T00:00:00.000Z",
};

describe("normalizeCommentRow", () => {
  it("maps snake_case to camelCase", () => {
    const n = normalizeCommentRow({ ...baseRow, resolved_by: "u9", resolved_summary: "done" });
    expect(n.id).toBe("c1");
    expect(n.previewId).toBe("p1");
    expect(n.authorParticipant).toBe("part-1");
    expect(n.trustLevel).toBe("member");
    expect(n.resolvedBy).toBe("u9");
    expect(n.resolvedSummary).toBe("done");
    expect(n.createdAt).toBe("2026-07-03T00:00:00.000Z");
  });

  it("applies the shared defaults when optional columns are absent/null", () => {
    const n = normalizeCommentRow(baseRow);
    expect(n.fidelity).toBe("live");
    expect(n.kind).toBe("comment");
    expect(n.lane).toBe("backlog");
    expect(n.reviewSummary).toBeNull();
    expect(n.isStale).toBe(false);
    expect(n.authorParticipant).toBe("part-1");
    expect(n.resolvedBy).toBeNull();
    expect(n.path).toBeNull();
    expect(n.context).toBeNull();
  });

  it("preserves explicit non-default values", () => {
    const n = normalizeCommentRow({
      ...baseRow,
      fidelity: "snapshot",
      kind: "template",
      lane: "ready_for_agent",
      review_summary: "raised the CTA to text-lg",
      is_stale: true,
    });
    expect(n.fidelity).toBe("snapshot");
    expect(n.kind).toBe("template");
    expect(n.lane).toBe("ready_for_agent");
    expect(n.reviewSummary).toBe("raised the CTA to text-lg");
    expect(n.isStale).toBe(true);
  });

  it("does NOT redact the note (redaction is the MCP decorator's job)", () => {
    const n = normalizeCommentRow({ ...baseRow, note: "token sk_live_abc" });
    expect(n.note).toBe("token sk_live_abc");
  });
});

describe("coerceCommentContext", () => {
  it("passes an object through", () => {
    const ctx = { selector: "button", anchors: [] };
    expect(coerceCommentContext(ctx)).toBe(ctx);
  });
  it("parses a JSON string (broadcast payload path)", () => {
    expect(coerceCommentContext('{"selector":"a","anchors":[]}')).toEqual({
      selector: "a",
      anchors: [],
    });
  });
  it("fails soft to null for null / invalid JSON / non-object", () => {
    expect(coerceCommentContext(null)).toBeNull();
    expect(coerceCommentContext(undefined)).toBeNull();
    expect(coerceCommentContext("not json")).toBeNull();
    expect(coerceCommentContext(42)).toBeNull();
  });
});

describe("COMMENT_ROW_COLUMNS + commentRowSchema", () => {
  it("lists the load-bearing columns", () => {
    for (const col of [
      "id", "preview_id", "number", "author_participant", "trust_level",
      "note", "context", "status", "fidelity", "kind", "lane",
      "review_summary", "is_stale", "resolved_by", "resolved_summary",
      "created_at",
    ]) {
      expect(COMMENT_ROW_COLUMNS).toContain(col);
    }
  });

  it("validates a minimal row and rejects a malformed one", () => {
    expect(commentRowSchema.safeParse(baseRow).success).toBe(true);
    expect(commentRowSchema.safeParse({ ...baseRow, trust_level: "boss" }).success).toBe(false);
    expect(commentRowSchema.safeParse({ ...baseRow, lane: "ready_for_agent" }).success).toBe(true);
    expect(commentRowSchema.safeParse({ ...baseRow, lane: "shipping" }).success).toBe(false);
  });
});

describe("withPrivateExtras (U1: R1-R5, R11)", () => {
  it("is a no-op when extras are omitted, leaving normalizeCommentRow's output untouched", () => {
    const n = normalizeCommentRow(baseRow);
    const merged = withPrivateExtras(n);
    expect(merged).toEqual(n);
    expect(merged.privatePrompt).toBeUndefined();
    expect(merged.referenceConfirmed).toBeUndefined();
  });

  it("merges a privatePrompt and referenceConfirmed onto the normalized row", () => {
    const n = normalizeCommentRow(baseRow);
    const merged = withPrivateExtras(n, {
      privatePrompt: { body: "sharpen this", authorDisplayName: "Ada" },
      referenceConfirmed: true,
    });
    expect(merged.privatePrompt).toEqual({
      body: "sharpen this",
      authorDisplayName: "Ada",
    });
    expect(merged.referenceConfirmed).toBe(true);
    // The rest of the row is untouched.
    expect(merged.id).toBe(n.id);
  });

  it("merges partial extras (one field set, the other omitted) independently", () => {
    const n = normalizeCommentRow(baseRow);
    const merged = withPrivateExtras(n, { referenceConfirmed: false });
    expect(merged.referenceConfirmed).toBe(false);
    expect(merged.privatePrompt).toBeUndefined();
  });
});
