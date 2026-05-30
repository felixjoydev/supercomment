import { describe, it, expect } from "vitest";
import {
  commentSchema,
  capturedContextSchema,
  newCommentInputSchema,
  listOpenCommentsOutputSchema,
  resolveCommentInputSchema,
} from "./schema.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const genericContext = {
  selector: "button.cta",
  anchors: [
    { type: "id", value: "submit-btn" },
    { type: "data-testid", value: "checkout-submit" },
    { type: "text", value: "Buy now" },
  ],
  computedStyles: { color: "rgb(255, 255, 255)", display: "flex" },
  surroundingHtml: "<button class=\"cta\" id=\"submit-btn\">Buy now</button>",
  boundingBox: { x: 10, y: 20, width: 120, height: 40 },
  url: "https://app.example.com/checkout",
  viewport: { width: 1440, height: 900, devicePixelRatio: 2 },
  consoleErrors: [
    { level: "error" as const, message: "Uncaught TypeError: x is undefined" },
  ],
  screenshot: "data:image/png;base64,iVBORw0KGgo=",
};

const reactContext = {
  ...genericContext,
  react: {
    componentPath: ["App", "CheckoutForm", "SubmitButton"],
    sourceFile: "src/components/SubmitButton.tsx",
    sourceLine: 42,
  },
};

const baseComment = {
  id: "11111111-1111-4111-8111-111111111111",
  previewId: "22222222-2222-4222-8222-222222222222",
  number: 1,
  author: { displayName: "Ada", trustLevel: "member" as const },
  intent: "fix" as const,
  severity: "critical" as const,
  note: "This button overflows on mobile.",
  context: genericContext,
  status: "open" as const,
  fidelity: "live" as const,
  createdAt: "2026-05-30T12:00:00.000Z",
};

// ---------------------------------------------------------------------------
// Happy paths
// ---------------------------------------------------------------------------

describe("commentSchema", () => {
  it("parses a valid comment with generic-only context", () => {
    const result = commentSchema.safeParse(baseComment);
    expect(result.success).toBe(true);
  });

  it("parses a valid comment with full React context", () => {
    const result = commentSchema.safeParse({
      ...baseComment,
      context: reactContext,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.context.react?.componentPath).toEqual([
        "App",
        "CheckoutForm",
        "SubmitButton",
      ]);
      expect(result.data.context.react?.sourceLine).toBe(42);
    }
  });

  it("parses a resolved comment with resolution metadata", () => {
    const result = commentSchema.safeParse({
      ...baseComment,
      status: "resolved",
      resolvedBy: "33333333-3333-4333-8333-333333333333",
      resolvedSummary: "Added a max-width and word-break.",
    });
    expect(result.success).toBe(true);
  });
});

describe("capturedContextSchema", () => {
  it("parses a generic-only context (no React fields)", () => {
    const result = capturedContextSchema.safeParse(genericContext);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.react).toBeUndefined();
    }
  });

  it("parses a full React context", () => {
    const result = capturedContextSchema.safeParse(reactContext);
    expect(result.success).toBe(true);
  });

  it("defaults consoleErrors to an empty array when omitted", () => {
    const { consoleErrors, ...withoutConsole } = genericContext;
    void consoleErrors;
    const result = capturedContextSchema.safeParse(withoutConsole);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.consoleErrors).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// Edge cases: missing required fields
// ---------------------------------------------------------------------------

describe("required-field validation", () => {
  it("rejects a context missing the selector", () => {
    const { selector, ...noSelector } = genericContext;
    void selector;
    const result = capturedContextSchema.safeParse(noSelector);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("selector");
    }
  });

  it("rejects a comment missing the note", () => {
    const { note, ...noNote } = baseComment;
    void note;
    const result = commentSchema.safeParse(noNote);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("note");
    }
  });

  it("rejects an empty note (min length)", () => {
    const result = commentSchema.safeParse({ ...baseComment, note: "" });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Edge cases: invalid enum values
// ---------------------------------------------------------------------------

describe("enum validation", () => {
  it("rejects an invalid intent value", () => {
    const result = commentSchema.safeParse({
      ...baseComment,
      intent: "refactor",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("intent");
    }
  });

  it("rejects an invalid severity value", () => {
    const result = commentSchema.safeParse({
      ...baseComment,
      severity: "blocker",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid trustLevel value", () => {
    const result = commentSchema.safeParse({
      ...baseComment,
      author: { displayName: "Mallory", trustLevel: "admin" },
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// newCommentInput (overlay -> RPC payload)
// ---------------------------------------------------------------------------

describe("newCommentInputSchema", () => {
  it("parses a valid overlay payload and defaults fidelity to live", () => {
    const result = newCommentInputSchema.safeParse({
      previewId: baseComment.previewId,
      authorDisplayName: "Guest Reviewer",
      intent: "change",
      severity: "minor",
      note: "Make this copy friendlier.",
      context: genericContext,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.fidelity).toBe("live");
    }
  });

  it("rejects a payload whose context has an invalid url", () => {
    const result = newCommentInputSchema.safeParse({
      previewId: baseComment.previewId,
      authorDisplayName: "Guest Reviewer",
      intent: "fix",
      severity: "minor",
      note: "Broken link.",
      context: { ...genericContext, url: "not-a-url" },
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// MCP tool I/O shapes
// ---------------------------------------------------------------------------

describe("MCP tool I/O schemas", () => {
  it("parses listOpenCommentsOutput with trust-tagged comments", () => {
    const result = listOpenCommentsOutputSchema.safeParse({
      comments: [{ ...baseComment, trustLevel: "member" }],
      excludedGuestCount: 2,
    });
    expect(result.success).toBe(true);
  });

  it("defaults excludedGuestCount to 0 when omitted", () => {
    const result = listOpenCommentsOutputSchema.safeParse({ comments: [] });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.excludedGuestCount).toBe(0);
    }
  });

  it("parses a resolveCommentInput payload", () => {
    const result = resolveCommentInputSchema.safeParse({
      number: 3,
      summary: "Fixed in PR #12.",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a resolveCommentInput with a non-positive number", () => {
    const result = resolveCommentInputSchema.safeParse({ number: 0 });
    expect(result.success).toBe(false);
  });
});
