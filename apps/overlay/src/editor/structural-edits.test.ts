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
