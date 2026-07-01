import { describe, it, expect } from "vitest";

import type { EditTarget, VisualChangeSet } from "@supercomment/shared";

import { buildDom, byId, type FakeDocument } from "../capture/test-dom.js";
import { captureAnchors } from "../capture/anchors.js";
import { applyChangeSet } from "./apply-change-set.js";

// Cross-page template reuse (U15/R9) exercised against the REAL corroborate-or
// -stale reanchor resolver (the capture DOM double supports id/[attr]/* queries),
// so these prove genuine re-anchoring across pages, not just injected outcomes.

function asDoc(doc: FakeDocument): Document {
  return doc as unknown as Document;
}

function styleOp(
  opId: string,
  target: EditTarget,
  property: string,
  after: string,
): VisualChangeSet["ops"][number] {
  return { opId, type: "setStyle", target, property, before: null, after };
}

describe("template cross-page reuse (R9)", () => {
  it("re-applies a shared-header edit on another page; page-specific edits skip (AE3)", () => {
    // Page 1 — capture the shared header's + a page-specific hero's anchors.
    const { doc: page1, root: root1 } = buildDom({
      tag: "body",
      children: [
        { tag: "header", id: "site-header", text: "Acme" },
        { tag: "section", id: "hero-home", text: "Home hero" },
      ],
    });
    void page1;
    const headerAnchors = captureAnchors(
      byId(root1, "site-header") as unknown as Element,
    );
    const heroAnchors = captureAnchors(
      byId(root1, "hero-home") as unknown as Element,
    );

    // Page 2 of the SAME build — same header, a different (non-section) body.
    const { doc: page2 } = buildDom({
      tag: "body",
      children: [
        { tag: "header", id: "site-header", text: "Acme" },
        { tag: "main", id: "pricing", text: "Pricing" },
      ],
    });

    const cs: VisualChangeSet = {
      ops: [
        styleOp(
          "o-header",
          { selector: "#site-header", anchors: headerAnchors },
          "background-color",
          "navy",
        ),
        styleOp(
          "o-hero",
          { selector: "#hero-home", anchors: heroAnchors },
          "padding",
          "40px",
        ),
      ],
    };

    const result = applyChangeSet(cs, asDoc(page2));

    expect(result.applied).toBe(1);
    expect(result.skipped).toBe(1);
    const header = result.results.find((r) => r.opId === "o-header")!;
    const hero = result.results.find((r) => r.opId === "o-hero")!;
    expect(header.applied).toBe(true); // shared header re-anchors by id
    expect(hero.applied).toBe(false); // the home-only hero isn't on this page
    expect(hero.reason).toBe("unresolved");
  });

  it("skips an ambiguous target rather than guessing, and reports it", () => {
    const { doc: page } = buildDom({
      tag: "body",
      children: [
        { tag: "button", text: "Subscribe" },
        { tag: "button", text: "Subscribe" },
      ],
    });
    // Non-unique anchors (role + text only): two buttons corroborate equally → tie.
    const target: EditTarget = {
      selector: "button",
      anchors: [
        { type: "role", value: "button" },
        { type: "text", value: "Subscribe" },
      ],
    };
    const cs: VisualChangeSet = { ops: [styleOp("o", target, "color", "red")] };

    const result = applyChangeSet(cs, asDoc(page));

    expect(result.applied).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.results[0]!.applied).toBe(false);
    expect(result.results[0]!.reason).toBe("unresolved"); // never guesses the first match
  });

  it("applies a uniquely-anchored edit on the same page", () => {
    const { doc: page, root } = buildDom({
      tag: "body",
      children: [{ tag: "h1", id: "headline", text: "Welcome" }],
    });
    const anchors = captureAnchors(byId(root, "headline") as unknown as Element);
    const cs: VisualChangeSet = {
      ops: [
        styleOp(
          "o",
          { selector: "#headline", anchors },
          "font-size",
          "48px",
        ),
      ],
    };
    const result = applyChangeSet(cs, asDoc(page));
    expect(result.applied).toBe(1);
    expect(result.results[0]!.applied).toBe(true);
  });
});
