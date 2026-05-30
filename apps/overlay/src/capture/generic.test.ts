import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { capturedContextSchema } from "@supercomment/shared";

import { captureGenericContext, buildUniqueSelector } from "./generic.js";
import {
  installConsoleErrorBuffer,
  resetConsoleErrorBuffer,
} from "./console-buffer.js";
import type { SelectionTarget } from "../core/types.js";
import { buildDom, byTag, allByTag, type FakeElement } from "./test-dom.js";

function asEl(el: unknown): Element {
  return el as Element;
}

function elementTarget(el: FakeElement): SelectionTarget {
  const r = el.getBoundingClientRect();
  return {
    kind: "element",
    element: asEl(el),
    rect: { x: r.x, y: r.y, width: r.width, height: r.height },
  };
}

beforeEach(() => {
  resetConsoleErrorBuffer();
});

afterEach(() => {
  resetConsoleErrorBuffer();
});

describe("captureGenericContext", () => {
  it("captures selector, computed styles, surrounding HTML, url, viewport and bounding box", () => {
    const { root } = buildDom({
      tag: "body",
      children: [
        {
          tag: "section",
          id: "wrap",
          children: [
            {
              tag: "button",
              attrs: { class: "css-hash", "data-testid": "cta" },
              text: "Buy now",
              rect: { x: 10, y: 20, width: 100, height: 40 },
            },
          ],
        },
      ],
    });
    const button = byTag(root, "button");
    const ctx = captureGenericContext(elementTarget(button));

    expect(ctx.selector).toContain('data-testid="cta"');
    expect(ctx.surroundingHtml).toContain("Buy now");
    expect(ctx.url).toBe("https://app.example.com/page?x=1");
    expect(ctx.viewport).toEqual({ width: 1024, height: 768, devicePixelRatio: 2 });
    expect(ctx.boundingBox).toEqual({ x: 10, y: 20, width: 100, height: 40 });
    expect(ctx.computedStyles?.display).toBe("block");
    expect(ctx.computedStyles?.fontSize).toBe("16px");
    // multi-anchor set comes along for the ride.
    expect(ctx.anchors.find((a) => a.type === "data-testid")?.value).toBe("cta");
  });

  it("produces output that validates against the capturedContext Zod schema", () => {
    const { root } = buildDom({
      tag: "div",
      id: "root",
      children: [{ tag: "p", text: "hello", rect: { x: 0, y: 0, width: 50, height: 12 } }],
    });
    const p = byTag(root, "p");
    const generic = captureGenericContext(elementTarget(p));

    // The composer adds optional react/screenshot; generic alone must already validate.
    const parsed = capturedContextSchema.parse(generic);
    expect(parsed.selector).toBe(generic.selector);
    expect(parsed.consoleErrors).toEqual([]);
  });

  it("buffers recent console errors and includes them in captured context", () => {
    installConsoleErrorBuffer();
    console.error("boom: something broke");
    console.warn("a warning too");

    const { root } = buildDom({ tag: "div", id: "x", text: "y" });
    const ctx = captureGenericContext(elementTarget(byTag(root, "div")));

    const messages = ctx.consoleErrors.map((e) => e.message);
    expect(messages).toContain("boom: something broke");
    expect(messages).toContain("a warning too");
    expect(ctx.consoleErrors.find((e) => e.message.includes("boom"))?.level).toBe(
      "error",
    );
    expect(ctx.consoleErrors.find((e) => e.message.includes("warning"))?.level).toBe(
      "warn",
    );
  });

  it("starts with no console errors when the buffer is freshly reset", () => {
    installConsoleErrorBuffer();
    const { root } = buildDom({ tag: "div", id: "x", text: "y" });
    const ctx = captureGenericContext(elementTarget(byTag(root, "div")));
    expect(ctx.consoleErrors).toEqual([]);
  });

  it("handles a text selection (no element) and still validates", () => {
    const target: SelectionTarget = {
      kind: "text",
      quotedText: "the quoted bit",
      rect: { x: 5, y: 5, width: 80, height: 16 },
    };
    const ctx = captureGenericContext(target);
    expect(ctx.anchors).toEqual([{ type: "text", value: "the quoted bit" }]);
    expect(ctx.boundingBox).toEqual({ x: 5, y: 5, width: 80, height: 16 });
    // url/viewport come from the global window which is absent in node env,
    // so url falls back; this must still validate.
    expect(() => capturedContextSchema.parse(ctx)).not.toThrow();
  });
});

describe("buildUniqueSelector", () => {
  it("prefers a document-unique id", () => {
    const { doc, root } = buildDom({
      tag: "div",
      id: "unique-1",
      children: [{ tag: "span", text: "a" }],
    });
    const el = root; // the #unique-1 div
    expect(buildUniqueSelector(asEl(el), doc as unknown as Document)).toBe(
      "#unique-1",
    );
  });

  it("prefers a stable attribute over hashed classes", () => {
    const { doc, root } = buildDom({
      tag: "div",
      children: [
        {
          tag: "button",
          attrs: { class: "css-aaa css-bbb", "data-testid": "submit" },
          text: "Go",
        },
      ],
    });
    const sel = buildUniqueSelector(
      asEl(byTag(root, "button")),
      doc as unknown as Document,
    );
    expect(sel).toContain('data-testid="submit"');
    expect(sel).not.toContain("css-aaa");
  });

  it("falls back to an nth-of-type path that resolves uniquely", () => {
    const { doc, root } = buildDom({
      tag: "ul",
      children: [
        { tag: "li", text: "one" },
        { tag: "li", text: "two" },
        { tag: "li", text: "three" },
      ],
    });
    const third = allByTag(root, "li")[2];
    const sel = buildUniqueSelector(asEl(third), doc as unknown as Document);
    expect(doc.querySelectorAll(sel).length).toBe(1);
    expect(doc.querySelectorAll(sel)[0]).toBe(third);
  });
});
