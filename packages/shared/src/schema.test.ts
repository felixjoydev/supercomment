import { describe, it, expect } from "vitest";
import {
  commentSchema,
  capturedContextSchema,
  newCommentInputSchema,
  listOpenCommentsOutputSchema,
  getCommentOutputSchema,
  resolveCommentInputSchema,
  visualChangeSetSchema,
  changeOpSchema,
  mcpCommentSchema,
  mcpPrivatePromptSchema,
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

  // -------------------------------------------------------------------------
  // U8 — governanceDocs envelope-level field (R14/R18, envelope-contract slot 3)
  // -------------------------------------------------------------------------

  it("accepts governanceDocs pointers on listOpenCommentsOutput", () => {
    const result = listOpenCommentsOutputSchema.safeParse({
      comments: [{ ...baseComment, trustLevel: "member" }],
      governanceDocs: ["AGENTS.md", "docs/design-guidelines.md"],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.governanceDocs).toEqual([
        "AGENTS.md",
        "docs/design-guidelines.md",
      ]);
    }
  });

  it("omits (not defaults) governanceDocs on listOpenCommentsOutput when absent", () => {
    const result = listOpenCommentsOutputSchema.safeParse({ comments: [] });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.governanceDocs).toBeUndefined();
      expect("governanceDocs" in result.data).toBe(false);
    }
  });

  it("accepts governanceDocs pointers on getCommentOutput", () => {
    const result = getCommentOutputSchema.safeParse({
      comment: { ...baseComment, trustLevel: "member" },
      governanceDocs: ["CLAUDE.md"],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.governanceDocs).toEqual(["CLAUDE.md"]);
    }
  });

  it("omits governanceDocs on getCommentOutput when absent, and never carries maturity", () => {
    const result = getCommentOutputSchema.safeParse({
      comment: { ...baseComment, trustLevel: "member" },
      // A stray `maturity` key (U9's separate slot-4 concern) must never be
      // a recognized field of THIS envelope — only governanceDocs crosses
      // this boundary.
      maturity: "mature",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.governanceDocs).toBeUndefined();
      expect("maturity" in result.data).toBe(false);
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

// ---------------------------------------------------------------------------
// Visual change-set + comment kind (U1: R11–R14)
// ---------------------------------------------------------------------------

const styleChangeSet = {
  authoredCommit: "abc1234",
  ops: [
    {
      opId: "op-1",
      type: "setStyle",
      target: {
        selector: "h1.hero",
        anchors: [{ type: "data-testid", value: "hero-heading" }],
        source: { file: "src/components/Hero.tsx", line: 12, column: 6 },
      },
      property: "font-size",
      before: "32px",
      after: "48px",
      valueToken: "text-5xl",
      responsive: "mobile",
    },
    {
      opId: "op-2",
      type: "insertNode",
      target: {
        selector: "section.hero",
        anchors: [{ type: "dom-path", value: "body>main>section:nth-child(1)" }],
        sourceUnknown: true,
      },
      insertion: {
        parent: {
          selector: "section.hero",
          anchors: [{ type: "data-testid", value: "hero" }],
          source: { file: "src/components/Hero.tsx", line: 10, column: 4 },
        },
        position: "append",
      },
      node: { tag: "button", text: "Buy now", attrs: { class: "cta" } },
    },
  ],
};

const templateComment = {
  ...baseComment,
  kind: "template",
  context: {
    ...genericContext,
    changeSet: styleChangeSet,
    referenceImages: ["proj-1/preview-1/ref-1.png"],
  },
};

describe("visual change-set + comment kind", () => {
  it("parses a template comment carrying a multi-op change-set", () => {
    const result = commentSchema.safeParse(templateComment);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.kind).toBe("template");
      expect(result.data.context.changeSet?.ops).toHaveLength(2);
      expect(result.data.context.referenceImages).toEqual([
        "proj-1/preview-1/ref-1.png",
      ]);
    }
  });

  it("defaults kind to 'comment' when omitted (existing comments unaffected)", () => {
    const result = commentSchema.safeParse(baseComment);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.kind).toBe("comment");
    }
  });

  it("leaves an ordinary context without a change-set", () => {
    const result = capturedContextSchema.safeParse(genericContext);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.changeSet).toBeUndefined();
    }
  });

  it("accepts an op with sourceUnknown and no source location", () => {
    const result = changeOpSchema.safeParse({
      opId: "op-x",
      type: "setText",
      target: {
        selector: "p.lead",
        anchors: [{ type: "text", value: "Hi" }],
        sourceUnknown: true,
      },
      before: "Hi",
      after: "Hello there",
    });
    expect(result.success).toBe(true);
  });

  it("accepts responsive + pseudo-state qualifiers", () => {
    const result = changeOpSchema.safeParse({
      opId: "op-y",
      type: "setStyle",
      target: { selector: "a.link", anchors: [{ type: "id", value: "link" }] },
      property: "color",
      before: "rgb(0, 0, 0)",
      after: "rgb(10, 132, 255)",
      responsive: "tablet",
      state: "hover",
    });
    expect(result.success).toBe(true);
  });

  it("accepts the additive previewUnavailable marker (and older ops without it)", () => {
    const withMarker = changeOpSchema.safeParse({
      opId: "op-pu",
      type: "setStyle",
      target: { selector: "a.link", anchors: [{ type: "id", value: "link" }] },
      property: "color",
      before: "rgb(0, 0, 0)",
      after: "rgb(10, 132, 255)",
      previewUnavailable: true,
    });
    expect(withMarker.success).toBe(true);
    if (withMarker.success) expect(withMarker.data.previewUnavailable).toBe(true);

    const withoutMarker = changeOpSchema.safeParse({
      opId: "op-nopu",
      type: "setStyle",
      target: { selector: "a.link", anchors: [] },
      property: "color",
      before: "black",
      after: "red",
    });
    expect(withoutMarker.success).toBe(true);
    if (withoutMarker.success) expect(withoutMarker.data.previewUnavailable).toBeUndefined();
  });

  it("carries a concrete insertion point + node for insertNode", () => {
    // Covers AE5: an add-element edit hands the agent a concrete insertion point.
    const result = changeOpSchema.safeParse(styleChangeSet.ops[1]);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.insertion?.position).toBe("append");
      expect(result.data.insertion?.parent?.source?.file).toBe(
        "src/components/Hero.tsx",
      );
      expect(result.data.node?.tag).toBe("button");
    }
  });

  it("rejects an unknown op type", () => {
    const result = changeOpSchema.safeParse({
      opId: "op-z",
      type: "recolorEverything",
      target: { selector: "x", anchors: [] },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a change-set with no ops", () => {
    const result = visualChangeSetSchema.safeParse({ ops: [] });
    expect(result.success).toBe(false);
  });
});

describe("visual change-set — stored-DOM-XSS rejection (M1)", () => {
  const target = { selector: "x", anchors: [] as never[] };

  it("accepts a safe insertNode (presentational tag + safe attrs)", () => {
    const result = changeOpSchema.safeParse({
      opId: "ok",
      type: "insertNode",
      target,
      node: { tag: "div", text: "hi", attrs: { class: "banner", title: "t" } },
    });
    expect(result.success).toBe(true);
  });

  it("rejects an insertNode with a script-capable tag", () => {
    for (const tag of ["script", "iframe", "object", "svg", "style"]) {
      const result = changeOpSchema.safeParse({
        opId: "bad",
        type: "insertNode",
        target,
        node: { tag },
      });
      expect(result.success, `tag ${tag} must be rejected`).toBe(false);
    }
  });

  it("rejects an insertNode carrying an on* handler or javascript: URL attr", () => {
    expect(
      changeOpSchema.safeParse({
        opId: "b1",
        type: "insertNode",
        target,
        node: { tag: "img", attrs: { onerror: "steal()" } },
      }).success,
    ).toBe(false);
    expect(
      changeOpSchema.safeParse({
        opId: "b2",
        type: "insertNode",
        target,
        node: { tag: "a", attrs: { href: "javascript:alert(1)" } },
      }).success,
    ).toBe(false);
  });

  it("rejects a setAttr op writing an on* handler or javascript: URL", () => {
    expect(
      changeOpSchema.safeParse({
        opId: "b3",
        type: "setAttr",
        target,
        property: "onclick",
        after: "steal()",
      }).success,
    ).toBe(false);
    expect(
      changeOpSchema.safeParse({
        opId: "b4",
        type: "setAttr",
        target,
        property: "href",
        after: "javascript:alert(1)",
      }).success,
    ).toBe(false);
  });

  it("accepts a setAttr op writing an ordinary attribute", () => {
    const result = changeOpSchema.safeParse({
      opId: "ok2",
      type: "setAttr",
      target,
      property: "title",
      after: "A helpful tooltip",
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Private prompt + reference confirm (U1: R4, R5, R8, R12, R18)
// ---------------------------------------------------------------------------

describe("mcpCommentSchema — privatePrompt / referenceConfirmed", () => {
  it("parses a comment with NO privatePrompt/referenceConfirmed (backward compatible, the common no-prompt path)", () => {
    const result = mcpCommentSchema.safeParse({
      ...baseComment,
      trustLevel: "member",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.privatePrompt).toBeUndefined();
      expect(result.data.referenceConfirmed).toBeUndefined();
    }
  });

  it("parses a comment WITH a privatePrompt and referenceConfirmed", () => {
    const result = mcpCommentSchema.safeParse({
      ...baseComment,
      trustLevel: "member",
      privatePrompt: {
        body: "Keep the CTA copy, just fix the mobile overflow.",
        authorDisplayName: "Ada",
      },
      referenceConfirmed: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.privatePrompt?.body).toBe(
        "Keep the CTA copy, just fix the mobile overflow.",
      );
      expect(result.data.privatePrompt?.authorDisplayName).toBe("Ada");
      expect(result.data.referenceConfirmed).toBe(true);
    }
  });

  it("distinguishes an ABSENT prompt from an EMPTY/whitespace one — both valid, not the same state", () => {
    const absent = mcpCommentSchema.safeParse({
      ...baseComment,
      trustLevel: "member",
    });
    const empty = mcpCommentSchema.safeParse({
      ...baseComment,
      trustLevel: "member",
      privatePrompt: { body: "", authorDisplayName: "Ada" },
    });
    const whitespace = mcpCommentSchema.safeParse({
      ...baseComment,
      trustLevel: "member",
      privatePrompt: { body: "   ", authorDisplayName: "Ada" },
    });
    expect(absent.success).toBe(true);
    expect(empty.success).toBe(true);
    expect(whitespace.success).toBe(true);
    if (absent.success && empty.success && whitespace.success) {
      expect(absent.data.privatePrompt).toBeUndefined();
      expect(empty.data.privatePrompt).toBeDefined();
      expect(empty.data.privatePrompt?.body).toBe("");
      expect(whitespace.data.privatePrompt?.body).toBe("   ");
      // Absent and empty are different states even though a downstream
      // consumer (U6) may choose to treat both as "no block to emit".
      expect(absent.data.privatePrompt).not.toEqual(empty.data.privatePrompt);
    }
  });

  it("mcpPrivatePromptSchema requires both body and authorDisplayName", () => {
    expect(
      mcpPrivatePromptSchema.safeParse({ body: "do the thing" }).success,
    ).toBe(false);
    expect(
      mcpPrivatePromptSchema.safeParse({
        body: "do the thing",
        authorDisplayName: "Ada",
      }).success,
    ).toBe(true);
  });

  it("rejects a non-boolean referenceConfirmed", () => {
    const result = mcpCommentSchema.safeParse({
      ...baseComment,
      trustLevel: "member",
      referenceConfirmed: "yes",
    });
    expect(result.success).toBe(false);
  });
});
