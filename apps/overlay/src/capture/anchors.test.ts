import { describe, it, expect } from "vitest";

import { captureAnchors, buildDomPath } from "./anchors.js";
import { buildDom, byId, byTag, allByTag } from "./test-dom.js";

// These tests use a hand-rolled DOM double (see test-dom.ts) because jsdom is
// not loadable in this sandbox; vitest runs in the `node` environment so there
// is no global `document`. The double is cast to the DOM `Element` shape the
// capture functions accept.
function asEl(el: unknown): Element {
  return el as Element;
}

describe("captureAnchors", () => {
  it("captures id and data-testid as typed anchors", () => {
    const { root } = buildDom({
      tag: "body",
      children: [
        {
          tag: "button",
          id: "save-btn",
          attrs: { "data-testid": "save", role: "button" },
          text: "Save changes",
        },
      ],
    });
    const anchors = captureAnchors(asEl(byId(root, "save-btn")));
    const byType = Object.fromEntries(anchors.map((a) => [a.type, a.value]));

    expect(byType.id).toBe("save-btn");
    expect(byType["data-testid"]).toBe("save");
    expect(byType.role).toBe("button");
    expect(byType.text).toBe("Save changes");
    expect(byType["dom-path"]).toBeTruthy();
  });

  it("falls back through data-cy and similar test-id variants", () => {
    const { root } = buildDom({
      tag: "body",
      children: [{ tag: "div", attrs: { "data-cy": "hero" } }],
    });
    const anchors = captureAnchors(asEl(byTag(root, "div")));
    expect(anchors.find((a) => a.type === "data-testid")?.value).toBe("hero");
  });

  it("derives an implicit role from the tag when no explicit role", () => {
    const { root } = buildDom({
      tag: "body",
      children: [{ tag: "a", attrs: { href: "#x" }, text: "Link text" }],
    });
    const anchors = captureAnchors(asEl(byTag(root, "a")));
    expect(anchors.find((a) => a.type === "role")?.value).toBe("link");
  });

  it("yields stable anchors (text + dom-path) for an element with only hashed classes", () => {
    const { root } = buildDom({
      tag: "body",
      children: [
        {
          tag: "section",
          children: [
            { tag: "div", attrs: { class: "css-1a2b3c css-x9y8z7" }, text: "Pricing" },
          ],
        },
      ],
    });
    const anchors = captureAnchors(asEl(byTag(root, "div")));
    const types = anchors.map((a) => a.type);

    // No id, no test-id — but durable anchors still exist beyond the brittle class selector.
    expect(types).not.toContain("id");
    expect(types).not.toContain("data-testid");
    expect(anchors.find((a) => a.type === "text")?.value).toBe("Pricing");
    expect(anchors.find((a) => a.type === "dom-path")?.value).toMatch(
      /div:nth-child\(\d+\)/,
    );
  });

  it("truncates long text content", () => {
    const { root } = buildDom({
      tag: "body",
      children: [{ tag: "p", text: "x".repeat(200) }],
    });
    const anchors = captureAnchors(asEl(byTag(root, "p")));
    const text = anchors.find((a) => a.type === "text")?.value as string;
    expect(text.length).toBeLessThanOrEqual(81); // 80 + ellipsis
    expect(text.endsWith("…")).toBe(true);
  });
});

describe("buildDomPath", () => {
  it("roots the path at an id so it stays short and stable", () => {
    const { root } = buildDom({
      tag: "div",
      children: [
        { tag: "span", text: "a" },
        { tag: "span", text: "b" },
        { tag: "span", id: "target", text: "c" },
      ],
    });
    const path = buildDomPath(asEl(byId(root, "target")))!;
    expect(path).toContain("span#target");
  });

  it("builds a full nth-child path when no ids are present", () => {
    const { root } = buildDom({
      tag: "main",
      children: [
        {
          tag: "ul",
          children: [
            { tag: "li", text: "one" },
            { tag: "li", text: "two" },
          ],
        },
      ],
    });
    const second = allByTag(root, "li")[1];
    const path = buildDomPath(asEl(second))!;
    expect(path).toContain("li:nth-child(2)");
  });
});
