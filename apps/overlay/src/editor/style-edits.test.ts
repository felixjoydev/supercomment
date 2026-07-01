import { describe, it, expect } from "vitest";

import type { EditTarget } from "@supercomment/shared";

import {
  buildStyleOp,
  buildTextOp,
  readComputedValue,
  readText,
  applyStylePreview,
  applyTextPreview,
} from "./style-edits.js";

const target: EditTarget = {
  selector: "h1.hero",
  anchors: [{ type: "id", value: "hero" }],
};

describe("buildStyleOp", () => {
  it("builds a setStyle op with before/after and a distinct id", () => {
    const op = buildStyleOp({
      target,
      property: "font-size",
      before: "16px",
      after: "24px",
    });
    expect(op.type).toBe("setStyle");
    expect(op.property).toBe("font-size");
    expect(op.before).toBe("16px");
    expect(op.after).toBe("24px");
    expect(op.opId).toBeTruthy();
    expect(op.valueToken).toBeUndefined();
    expect(op.responsive).toBeUndefined();
    expect(op.state).toBeUndefined();
  });

  it("carries optional token/responsive/state when supplied", () => {
    const op = buildStyleOp({
      target,
      property: "color",
      before: "rgb(0, 0, 0)",
      after: "rgb(10, 132, 255)",
      valueToken: "blue-500",
      responsive: "mobile",
      state: "hover",
    });
    expect(op.valueToken).toBe("blue-500");
    expect(op.responsive).toBe("mobile");
    expect(op.state).toBe("hover");
  });

  it("gives each op a distinct id", () => {
    const a = buildStyleOp({ target, property: "color", before: "a", after: "b" });
    const b = buildStyleOp({ target, property: "color", before: "a", after: "b" });
    expect(a.opId).not.toBe(b.opId);
  });
});

describe("buildTextOp", () => {
  it("builds a setText op with normalized before/after", () => {
    const op = buildTextOp(target, "Hi", "Hello there");
    expect(op.type).toBe("setText");
    expect(op.before).toBe("Hi");
    expect(op.after).toBe("Hello there");
  });
});

function fakeComputed(computed: Record<string, string>): Element {
  return {
    ownerDocument: {
      defaultView: {
        getComputedStyle: () => ({
          getPropertyValue: (p: string) => computed[p] ?? "",
        }),
      },
    },
  } as unknown as Element;
}

describe("readComputedValue", () => {
  it("reads and trims the computed value", () => {
    expect(
      readComputedValue(fakeComputed({ "font-size": " 16px " }), "font-size"),
    ).toBe("16px");
  });

  it("returns null for an empty / absent value", () => {
    expect(readComputedValue(fakeComputed({}), "color")).toBeNull();
  });

  it("never throws when the DOM API is missing", () => {
    expect(readComputedValue({} as Element, "color")).toBeNull();
  });
});

describe("readText", () => {
  it("collapses whitespace and trims", () => {
    expect(readText({ textContent: "  Buy   now \n" } as Element)).toBe(
      "Buy now",
    );
  });

  it("never throws on a text-less element", () => {
    expect(readText({} as Element)).toBe("");
  });
});

describe("applyStylePreview / applyTextPreview", () => {
  it("sets an inline style property on the live element", () => {
    const set: Record<string, string> = {};
    const el = {
      style: {
        setProperty: (p: string, v: string) => {
          set[p] = v;
        },
      },
    } as unknown as Element;
    applyStylePreview(el, "font-size", "24px");
    expect(set["font-size"]).toBe("24px");
  });

  it("never throws on a style-less element", () => {
    expect(() => applyStylePreview({} as Element, "color", "red")).not.toThrow();
  });

  it("sets text content", () => {
    const el = { textContent: "old" } as Element;
    applyTextPreview(el, "new copy");
    expect(el.textContent).toBe("new copy");
  });
});
