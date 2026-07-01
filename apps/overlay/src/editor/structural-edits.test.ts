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
} from "./structural-edits.js";

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
