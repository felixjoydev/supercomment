import { describe, it, expect } from "vitest";

import type { EditTarget, InsertionPoint, NewNode } from "@supercomment/shared";

import {
  buildInsertOp,
  buildRemoveOp,
  buildSetVisibilityOp,
  buildMoveOp,
  buildSwapMediaOp,
  previewHide,
  previewShow,
  previewOrder,
  previewMove,
  previewSwapMedia,
  classifySwapUrl,
  isReapplicableMediaSrc,
} from "./structural-edits.js";
import { makeFakeDom, type FakeElement } from "../test/dom-double.js";

const target: EditTarget = {
  selector: "section.hero",
  anchors: [{ type: "data-testid", value: "hero" }],
};
const insertion: InsertionPoint = { parent: target, position: "append" };
const node: NewNode = { tag: "button", text: "Buy now", attrs: { class: "cta" } };

describe("structural op-builders", () => {
  it("buildInsertOp carries the insertion point + node and targets the parent", () => {
    const op = buildInsertOp(insertion, node);
    expect(op.type).toBe("insertNode");
    expect(op.insertion?.position).toBe("append");
    expect(op.node?.tag).toBe("button");
    expect(op.target.selector).toBe("section.hero");
  });

  it("buildRemoveOp builds a removeNode", () => {
    expect(buildRemoveOp(target).type).toBe("removeNode");
  });

  it("buildSetVisibilityOp records hide as visible -> hidden (so show cancels it)", () => {
    const op = buildSetVisibilityOp(target, true);
    expect(op.type).toBe("setVisibility");
    expect(op.before).toBe("visible");
    expect(op.after).toBe("hidden");
  });

  it("buildMoveOp carries order + insertion point", () => {
    const op = buildMoveOp(target, insertion, 2, 0);
    expect(op.type).toBe("moveNode");
    expect(op.order).toEqual({ from: 2, to: 0 });
    expect(op.insertion?.position).toBe("append");
  });

  it("buildSwapMediaOp builds a setAttr on src", () => {
    const op = buildSwapMediaOp(target, "/old.png", "/new.png");
    expect(op.type).toBe("setAttr");
    expect(op.property).toBe("src");
    expect(op.before).toBe("/old.png");
    expect(op.after).toBe("/new.png");
  });

  it("gives each op a distinct id", () => {
    expect(buildRemoveOp(target).opId).not.toBe(buildRemoveOp(target).opId);
  });
});

function fakeStyleEl(initial: Record<string, string> = {}): Element {
  const style: Record<string, unknown> = {
    ...initial,
    setProperty(p: string, v: string) {
      style[p] = v;
    },
    removeProperty(p: string) {
      delete style[p];
    },
  };
  return { style } as unknown as Element;
}

function styleProps(el: Element): Record<string, unknown> {
  return (el as unknown as { style: Record<string, unknown> }).style;
}

describe("non-destructive previews", () => {
  it("previewHide sets display:none and returns the prior display", () => {
    const el = fakeStyleEl({ display: "flex" });
    const prior = previewHide(el);
    expect(prior).toBe("flex");
    expect(styleProps(el).display).toBe("none");
  });

  it("previewShow restores the prior display", () => {
    const el = fakeStyleEl({ display: "none" });
    previewShow(el, "block");
    expect(styleProps(el).display).toBe("block");
  });

  it("previewShow removes display when there was no prior inline value", () => {
    const el = fakeStyleEl({ display: "none" });
    previewShow(el, null);
    expect(styleProps(el).display).toBeUndefined();
  });

  it("previewOrder sets the CSS order property", () => {
    const el = fakeStyleEl();
    previewOrder(el, 3);
    expect(styleProps(el).order).toBe("3");
  });

  it("never throws on a style-less element", () => {
    expect(() => previewHide({} as Element)).not.toThrow();
    expect(() => previewShow({} as Element, "block")).not.toThrow();
    expect(() => previewOrder({} as Element, 1)).not.toThrow();
  });
});

describe("previewMove — real reorder + exact revert (requirement F)", () => {
  function tree(): { parent: FakeElement; a: FakeElement; b: FakeElement; c: FakeElement } {
    const { doc } = makeFakeDom();
    const parent = doc.createElement("section");
    const a = doc.createElement("div");
    const b = doc.createElement("div");
    const c = doc.createElement("div");
    a.textContent = "A";
    b.textContent = "B";
    c.textContent = "C";
    parent.append(a, b, c);
    return { parent, a, b, c };
  }
  const order = (p: FakeElement) => p.children.map((k) => k.textContent).join("");

  it("actually moves the node before a reference (visible reorder, not CSS order)", () => {
    const { parent, b, a } = tree();
    // Move B before A → B A C.
    previewMove(b as unknown as Element, a as unknown as Element, "before");
    expect(order(parent)).toBe("BAC");
  });

  it("moves after a reference", () => {
    const { parent, a, c } = tree();
    // Move A after C → B C A.
    previewMove(a as unknown as Element, c as unknown as Element, "after");
    expect(order(parent)).toBe("BCA");
  });

  it("the returned closure restores the exact original position", () => {
    const { parent, b, a } = tree();
    const revert = previewMove(b as unknown as Element, a as unknown as Element, "before");
    expect(order(parent)).toBe("BAC");
    revert();
    expect(order(parent)).toBe("ABC");
  });

  it("restores a middle node to its slot even after moving to the end", () => {
    const { parent, b, c } = tree();
    const revert = previewMove(b as unknown as Element, c as unknown as Element, "after");
    expect(order(parent)).toBe("ACB");
    revert();
    expect(order(parent)).toBe("ABC");
  });

  it("never throws for an orphan element and returns a no-op revert", () => {
    const { doc } = makeFakeDom();
    const orphan = doc.createElement("div");
    let revert: () => void = () => {};
    expect(() => {
      revert = previewMove(orphan as unknown as Element, null, "before");
    }).not.toThrow();
    expect(() => revert()).not.toThrow();
  });
});

describe("classifySwapUrl — replace-image URL policy (U6)", () => {
  it("accepts https to a public host and flags same-origin", () => {
    expect(classifySwapUrl("https://cdn.example.com/a.png")).toMatchObject({ ok: true });
    expect(
      classifySwapUrl("https://reviewed.example/a.png", "https://reviewed.example"),
    ).toMatchObject({ ok: true, sameOrigin: true });
    expect(
      classifySwapUrl("https://third.party/a.png", "https://reviewed.example"),
    ).toMatchObject({ ok: true, sameOrigin: false });
  });

  it("rejects http, javascript:, and private/localhost hosts", () => {
    expect(classifySwapUrl("http://x.com/a.png").reason).toBe("not-https");
    expect(classifySwapUrl("javascript:alert(1)").reason).toBe("not-https");
    expect(classifySwapUrl("https://localhost/a.png").reason).toBe("private-host");
    expect(classifySwapUrl("https://127.0.0.1/a.png").reason).toBe("private-host");
    expect(classifySwapUrl("https://192.168.1.5/a.png").reason).toBe("private-host");
    expect(classifySwapUrl("").reason).toBe("empty");
  });
});

describe("isReapplicableMediaSrc — never re-apply a hostile swap to other viewers (U6)", () => {
  const origin = "https://reviewed.example";
  it("re-applies same-origin https and relative URLs only", () => {
    expect(isReapplicableMediaSrc("https://reviewed.example/a.png", origin)).toBe(true);
    expect(isReapplicableMediaSrc("/assets/a.png", origin)).toBe(true);
    expect(isReapplicableMediaSrc("a.png", origin)).toBe(true);
  });
  it("is record-intent-only for cross-origin, blob:, and data: URLs", () => {
    expect(isReapplicableMediaSrc("https://third.party/a.png", origin)).toBe(false);
    expect(isReapplicableMediaSrc("blob:https://reviewed.example/abc", origin)).toBe(false);
    expect(isReapplicableMediaSrc("data:image/png;base64,AAAA", origin)).toBe(false);
    expect(isReapplicableMediaSrc("http://reviewed.example/a.png", origin)).toBe(false);
  });
});

describe("previewSwapMedia — neutralize responsive machinery + exact restore (U6)", () => {
  it("neutralizes the img srcset/sizes, sets src, and restores byte-identical", () => {
    const { doc } = makeFakeDom();
    const img = doc.createElement("img");
    img.setAttribute("src", "old.png");
    img.setAttribute("srcset", "old.png 1x, old@2x.png 2x");
    img.setAttribute("sizes", "100vw");
    const p = previewSwapMedia(img as unknown as Element, "new.png");
    expect(img.getAttribute("src")).toBe("new.png");
    expect(img.getAttribute("srcset")).toBeNull(); // neutralized so the swap shows
    expect(img.getAttribute("sizes")).toBeNull();
    p.restore();
    expect(img.getAttribute("src")).toBe("old.png");
    expect(img.getAttribute("srcset")).toBe("old.png 1x, old@2x.png 2x");
    expect(img.getAttribute("sizes")).toBe("100vw");
  });

  it("also neutralizes each <picture><source> child and restores them", () => {
    const { doc } = makeFakeDom();
    const picture = doc.createElement("picture");
    const source = doc.createElement("source");
    source.setAttribute("srcset", "old.avif");
    source.setAttribute("media", "(min-width: 800px)");
    const img = doc.createElement("img");
    img.setAttribute("src", "old.png");
    picture.append(source, img);
    doc.body.appendChild(picture);
    const p = previewSwapMedia(img as unknown as Element, "new.png");
    expect(source.getAttribute("srcset")).toBeNull();
    expect(source.getAttribute("media")).toBeNull();
    p.restore();
    expect(source.getAttribute("srcset")).toBe("old.avif");
    expect(source.getAttribute("media")).toBe("(min-width: 800px)");
  });
});
