import { describe, it, expect } from "vitest";

import type { EditTarget, VisualChangeSet } from "@supercomment/shared";

import { buildDom, byId, type FakeDocument } from "../capture/test-dom.js";
import { captureAnchors } from "../capture/anchors.js";
import { applyChangeSet } from "./apply-change-set.js";
import { makeFakeDom, type FakeElement } from "../test/dom-double.js";

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

  it("re-applies a moveNode as the SAME real DOM move it previewed (AE2/R5, U5)", () => {
    // A parent with three children a, b, c; the saved edit moved b before a.
    const { doc } = makeFakeDom();
    const parent = doc.createElement("div");
    parent.className = "parent";
    const a = doc.createElement("div");
    a.className = "a";
    const b = doc.createElement("div");
    b.className = "b";
    const c = doc.createElement("div");
    c.className = "c";
    parent.append(a, b, c);
    doc.body.appendChild(parent);
    const resolve = (t: { selector: string }): FakeElement | null =>
      ({ ".parent": parent, ".a": a, ".b": b, ".c": c }[t.selector] ?? null);

    const cs: VisualChangeSet = {
      ops: [
        {
          opId: "m1",
          type: "moveNode",
          target: { selector: ".b", anchors: [] },
          insertion: {
            position: "before",
            parent: { selector: ".parent", anchors: [] },
            reference: { selector: ".a", anchors: [] },
          },
          order: { from: 1, to: 0 },
        },
      ],
    };
    const result = applyChangeSet(cs, doc as unknown as Document, {
      resolve: resolve as unknown as (t: EditTarget, d: Document) => Element | null,
    });
    expect(result.applied).toBe(1);
    expect(parent.children.indexOf(b)).toBe(0); // b moved before a, a real DOM move
    result.revert();
    expect(parent.children.indexOf(b)).toBe(1); // deselect restores the exact slot
  });

  it("skips a moveNode whose reference sibling no longer resolves (drift, no throw)", () => {
    const { doc } = makeFakeDom();
    const el = doc.createElement("div");
    el.className = "b";
    doc.body.appendChild(el);
    const resolve = (t: { selector: string }): FakeElement | null =>
      (t.selector === ".b" ? el : null); // the reference ".gone" resolves to null
    const cs: VisualChangeSet = {
      ops: [
        {
          opId: "m1",
          type: "moveNode",
          target: { selector: ".b", anchors: [] },
          insertion: { position: "after", reference: { selector: ".gone", anchors: [] } },
          order: { from: 2, to: 5 },
        },
      ],
    };
    const result = applyChangeSet(cs, doc as unknown as Document, {
      resolve: resolve as unknown as (t: EditTarget, d: Document) => Element | null,
    });
    expect(result.applied).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.results[0]!.reason).toBe("inapplicable");
  });

  it("re-applies a same-origin image swap but never a cross-origin one (record-intent-only, U6)", () => {
    const { doc } = makeFakeDom();
    (doc.defaultView as unknown as { location: { origin: string } }).location = {
      origin: "https://reviewed.example",
    };
    const same = doc.createElement("img");
    same.className = "same";
    same.setAttribute("src", "a.png");
    const cross = doc.createElement("img");
    cross.className = "cross";
    cross.setAttribute("src", "b.png");
    doc.body.append(same, cross);
    const resolve = (t: { selector: string }): FakeElement | null =>
      ({ ".same": same, ".cross": cross }[t.selector] ?? null);
    const cs: VisualChangeSet = {
      ops: [
        {
          opId: "s1",
          type: "setAttr",
          target: { selector: ".same", anchors: [] },
          property: "src",
          before: "a.png",
          after: "https://reviewed.example/new.png",
        },
        {
          opId: "s2",
          type: "setAttr",
          target: { selector: ".cross", anchors: [] },
          property: "src",
          before: "b.png",
          after: "https://evil.example/track.png",
        },
      ],
    };
    const result = applyChangeSet(cs, doc as unknown as Document, {
      resolve: resolve as unknown as (t: EditTarget, d: Document) => Element | null,
    });
    expect(result.applied).toBe(1); // same-origin swap re-applied
    expect(result.skipped).toBe(1); // cross-origin swap is record-intent-only
    expect(same.getAttribute("src")).toBe("https://reviewed.example/new.png");
    expect(cross.getAttribute("src")).toBe("b.png"); // NEVER mutated into a viewer's DOM
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
