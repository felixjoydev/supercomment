import { describe, it, expect } from "vitest";

import type { ElementAnchor } from "@supercomment/shared";

import { resolveAnchors } from "./reanchor.js";
import { buildDom, byId, byTag, allByTag, type FakeDocument } from "./test-dom.js";

// These tests use the hand-rolled DOM double (see test-dom.ts) because jsdom is
// not loadable in this sandbox; vitest runs in the `node` environment so there
// is no global `document`. The double is cast to the DOM `Document`/`Element`
// shapes the resolver accepts; identity (===) still holds because the double's
// querySelectorAll returns the real element instances.
function asDoc(doc: FakeDocument): Document {
  return doc as unknown as Document;
}
function asEl(el: unknown): Element {
  return el as Element;
}

describe("resolveAnchors — unique high-durability matches", () => {
  it("resolves a unique id without corroboration", () => {
    const { doc, root } = buildDom({
      tag: "body",
      children: [{ tag: "button", id: "save", text: "Save" }],
    });
    const anchors: ElementAnchor[] = [{ type: "id", value: "save" }];

    const result = resolveAnchors(anchors, asDoc(doc));
    expect(result.isStale).toBe(false);
    expect(result.element).toBe(asEl(byId(root, "save")));
  });

  it("resolves a unique data-testid without corroboration", () => {
    const { doc, root } = buildDom({
      tag: "body",
      children: [{ tag: "div", attrs: { "data-testid": "hero" }, text: "Hero" }],
    });
    const anchors: ElementAnchor[] = [{ type: "data-testid", value: "hero" }];

    const result = resolveAnchors(anchors, asDoc(doc));
    expect(result.isStale).toBe(false);
    expect(result.element).toBe(asEl(byTag(root, "div")));
  });

  it("re-finds a data-testid anchor sourced from a variant attribute (data-cy)", () => {
    // Capture stores the canonical `data-testid` type even when the value came
    // from data-cy; the resolver must search the same attribute set.
    const { doc, root } = buildDom({
      tag: "body",
      children: [{ tag: "div", attrs: { "data-cy": "hero" }, text: "Hero" }],
    });
    const anchors: ElementAnchor[] = [{ type: "data-testid", value: "hero" }];

    const result = resolveAnchors(anchors, asDoc(doc));
    expect(result.isStale).toBe(false);
    expect(result.element).toBe(asEl(byTag(root, "div")));
  });

  it("treats a UNIQUE id as authoritative even over the implicit-role table", () => {
    const { doc, root } = buildDom({
      tag: "body",
      children: [
        { tag: "button", text: "A" },
        { tag: "button", id: "target", text: "B" },
      ],
    });
    const anchors: ElementAnchor[] = [
      { type: "id", value: "target" },
      { type: "role", value: "button" }, // non-unique, but id already wins
    ];

    const result = resolveAnchors(anchors, asDoc(doc));
    expect(result.isStale).toBe(false);
    expect(result.element).toBe(asEl(byId(root, "target")));
  });
});

describe("resolveAnchors — non-unique anchors require corroboration", () => {
  it("does NOT first-match an ambiguous role (N>1, no corroboration) → stale", () => {
    const { doc, root } = buildDom({
      tag: "body",
      children: [
        { tag: "button", text: "Alpha" },
        { tag: "button", text: "Beta" },
      ],
    });
    const anchors: ElementAnchor[] = [{ type: "role", value: "button" }];

    const result = resolveAnchors(anchors, asDoc(doc));
    // Two buttons share role=button and nothing else agrees: honest stale, NOT
    // a guess at the first button.
    expect(result.isStale).toBe(true);
    expect(result.element).toBeNull();
    // Guard against silent first-match regressions.
    expect(result.element).not.toBe(asEl(allByTag(root, "button")[0]));
  });

  it("resolves a role corroborated by a text anchor on the same element", () => {
    const { doc, root } = buildDom({
      tag: "body",
      children: [
        { tag: "button", text: "Submit" },
        { tag: "button", text: "Cancel" },
      ],
    });
    const anchors: ElementAnchor[] = [
      { type: "role", value: "button" },
      { type: "text", value: "Submit" },
    ];

    const result = resolveAnchors(anchors, asDoc(doc));
    expect(result.isStale).toBe(false);
    expect(result.element).toBe(asEl(allByTag(root, "button")[0])); // the "Submit" one
  });

  it("resolves the corroborated one when a data-testid is non-unique (>1)", () => {
    // A non-unique high-durability anchor is NOT trusted alone — it must be
    // corroborated like role/text/dom-path.
    const { doc, root } = buildDom({
      tag: "body",
      children: [
        { tag: "button", attrs: { "data-testid": "shared" }, text: "One" },
        { tag: "button", attrs: { "data-testid": "shared" }, text: "Two" },
      ],
    });
    const anchors: ElementAnchor[] = [
      { type: "data-testid", value: "shared" }, // matches both
      { type: "text", value: "Two" }, // breaks the tie
    ];

    const result = resolveAnchors(anchors, asDoc(doc));
    expect(result.isStale).toBe(false);
    expect(result.element).toBe(asEl(allByTag(root, "button")[1])); // "Two"
  });

  it("resolves when dom-path and text agree on one element", () => {
    const { doc, root } = buildDom({
      tag: "html",
      children: [
        {
          tag: "body",
          children: [
            { tag: "button", text: "First" },
            { tag: "button", text: "Second" },
          ],
        },
      ],
    });
    const anchors: ElementAnchor[] = [
      { type: "dom-path", value: "html > body > button:nth-child(2)" },
      { type: "text", value: "Second" },
    ];

    const result = resolveAnchors(anchors, asDoc(doc));
    expect(result.isStale).toBe(false);
    expect(result.element).toBe(asEl(allByTag(root, "button")[1])); // "Second"
  });

  it("goes stale when a single dom-path matches but text changed (no guess)", () => {
    const { doc } = buildDom({
      tag: "html",
      children: [
        {
          tag: "body",
          children: [
            { tag: "button", text: "First" },
            { tag: "button", text: "Second" },
          ],
        },
      ],
    });
    const anchors: ElementAnchor[] = [
      // dom-path resolves to exactly one (the first) button...
      { type: "dom-path", value: "html > body > button:nth-child(1)" },
      // ...but the text no longer matches anything → no corroboration.
      { type: "text", value: "Old Label" },
    ];

    const result = resolveAnchors(anchors, asDoc(doc));
    expect(result.isStale).toBe(true);
    expect(result.element).toBeNull();
  });

  it("goes stale when an added wrapper shifts the dom-path and text changed", () => {
    // Before: <body><span/><button>Save</button></body> → button is nth-child(2).
    // After: a wrapper div is added, so the button is now div's nth-child(1);
    // the stored path "...button:nth-child(2)" no longer matches it.
    const { doc } = buildDom({
      tag: "html",
      children: [
        {
          tag: "body",
          children: [
            { tag: "span", text: "x" },
            {
              tag: "div",
              children: [
                { tag: "button", text: "Save" },
                { tag: "span", text: "more" },
              ],
            },
          ],
        },
      ],
    });
    const anchors: ElementAnchor[] = [
      { type: "dom-path", value: "html > body > button:nth-child(2)" },
      { type: "text", value: "Old Save" }, // text also changed
    ];

    const result = resolveAnchors(anchors, asDoc(doc));
    expect(result.isStale).toBe(true);
    expect(result.element).toBeNull();
  });

  it("goes stale on an ambiguous tie (two elements each matched by 2 anchors)", () => {
    const { doc } = buildDom({
      tag: "body",
      children: [
        { tag: "button", attrs: { role: "tab" }, text: "Same" },
        { tag: "button", attrs: { role: "tab" }, text: "Same" },
      ],
    });
    const anchors: ElementAnchor[] = [
      { type: "role", value: "tab" }, // both
      { type: "text", value: "Same" }, // both
    ];

    const result = resolveAnchors(anchors, asDoc(doc));
    // Each candidate is corroborated by 2 anchors, but they tie — no single
    // confident element, so stale rather than a coin-flip.
    expect(result.isStale).toBe(true);
    expect(result.element).toBeNull();
  });
});

describe("resolveAnchors — nothing resolves", () => {
  it("is stale for an empty anchor set", () => {
    const { doc } = buildDom({ tag: "body", children: [{ tag: "p", text: "hi" }] });
    const result = resolveAnchors([], asDoc(doc));
    expect(result.isStale).toBe(true);
    expect(result.element).toBeNull();
  });

  it("is stale when the element was removed (no anchor matches)", () => {
    const { doc } = buildDom({
      tag: "html",
      children: [{ tag: "body", children: [{ tag: "p", text: "hello" }] }],
    });
    const anchors: ElementAnchor[] = [
      { type: "id", value: "gone" },
      { type: "data-testid", value: "missing" },
      { type: "role", value: "button" },
      { type: "text", value: "Vanished" },
      { type: "dom-path", value: "html > body > section:nth-child(1)" },
    ];

    const result = resolveAnchors(anchors, asDoc(doc));
    expect(result.isStale).toBe(true);
    expect(result.element).toBeNull();
  });

  it("is stale when only a single non-unique anchor matches (text alone)", () => {
    const { doc } = buildDom({
      tag: "body",
      children: [
        { tag: "button", text: "Click me" },
        { tag: "button", text: "Other" },
      ],
    });
    // Text matches exactly one element, but a lone non-unique anchor is never
    // trusted — it needs a second agreeing anchor.
    const anchors: ElementAnchor[] = [{ type: "text", value: "Click me" }];

    const result = resolveAnchors(anchors, asDoc(doc));
    expect(result.isStale).toBe(true);
    expect(result.element).toBeNull();
  });
});
