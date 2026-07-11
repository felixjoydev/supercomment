import { describe, it, expect } from "vitest";

import type { EditTarget } from "@supercomment/shared";

import {
  buildStyleOp,
  buildTextOp,
  readComputedValue,
  readText,
  applyStylePreview,
  applyTextPreview,
  applyStyleVerified,
  readInlineSnapshot,
  restoreInlineSnapshot,
  layoutEditImpliesFlex,
} from "./style-edits.js";
import { basicProbe } from "./color/normalize.js";

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

// A verify-capable element: a real inline CSSOM surface (value + priority) plus a
// getComputedStyle that models a site rule winning per its priority.
function makeVerifyEl(opts: {
  site?: { property: string; value: string; important?: boolean; unbeatable?: boolean };
  initial?: Record<string, string>;
} = {}): { el: Element; inline: Map<string, { value: string; priority: string }> } {
  const inline = new Map<string, { value: string; priority: string }>();
  const computed = (prop: string): string => {
    const site = opts.site && opts.site.property === prop ? opts.site : null;
    const i = inline.get(prop);
    if (site) {
      if (site.unbeatable) return site.value;
      if (site.important && (!i || i.priority !== "important")) return site.value;
    }
    if (i) return i.value;
    return opts.initial?.[prop] ?? "";
  };
  const el = {
    style: {
      setProperty: (p: string, v: string, pr = "") => inline.set(p, { value: v, priority: pr }),
      getPropertyValue: (p: string) => inline.get(p)?.value ?? "",
      getPropertyPriority: (p: string) => inline.get(p)?.priority ?? "",
      removeProperty: (p: string) => inline.delete(p),
    },
    ownerDocument: {
      defaultView: { getComputedStyle: () => ({ getPropertyValue: computed }) },
    },
  } as unknown as Element;
  return { el, inline };
}

describe("readInlineSnapshot / restoreInlineSnapshot", () => {
  it("round-trips a value + priority byte-identical, including !important", () => {
    const { el, inline } = makeVerifyEl();
    (el as unknown as { style: { setProperty(p: string, v: string, pr?: string): void } })
      .style.setProperty("color", "red", "important");
    const snap = readInlineSnapshot(el, "color");
    expect(snap).toEqual({ value: "red", priority: "important" });

    inline.set("color", { value: "blue", priority: "" }); // simulate an edit
    restoreInlineSnapshot(el, "color", snap);
    expect(inline.get("color")).toEqual({ value: "red", priority: "important" });
  });

  it("an empty snapshot removes the declaration", () => {
    const { el, inline } = makeVerifyEl();
    inline.set("color", { value: "blue", priority: "" });
    restoreInlineSnapshot(el, "color", { value: "", priority: "" });
    expect(inline.has("color")).toBe(false);
  });
});

describe("applyStyleVerified", () => {
  it("applies a plain write with no escalation when nothing beats it", () => {
    const { el, inline } = makeVerifyEl();
    const r = applyStyleVerified(el, "color", "rgb(255, 0, 0)", { probe: basicProbe });
    expect(r.previewUnavailable).toBe(false);
    expect(inline.get("color")).toEqual({ value: "rgb(255, 0, 0)", priority: "" });
  });

  it("escalates to !important when a site !important rule beats the plain write", () => {
    const { el, inline } = makeVerifyEl({
      site: { property: "color", value: "rgb(0, 0, 255)", important: true },
    });
    const r = applyStyleVerified(el, "color", "rgb(255, 0, 0)", { probe: basicProbe });
    expect(r.previewUnavailable).toBe(false);
    expect(inline.get("color")?.priority).toBe("important");
  });

  it("flags previewUnavailable when even the escalation loses", () => {
    const { el } = makeVerifyEl({
      site: { property: "color", value: "rgb(0, 0, 255)", unbeatable: true },
    });
    const r = applyStyleVerified(el, "color", "rgb(255, 0, 0)", { probe: basicProbe });
    expect(r.previewUnavailable).toBe(true);
  });

  it("neutralizes an active transition during readback and restores it byte-identical", () => {
    const { el, inline } = makeVerifyEl();
    inline.set("transition", { value: "color .3s", priority: "" });
    const r = applyStyleVerified(el, "color", "rgb(255, 0, 0)", { probe: basicProbe });
    expect(r.previewUnavailable).toBe(false); // no false escalation from the transition
    expect(inline.get("transition")).toEqual({ value: "color .3s", priority: "" });
  });

  it("never throws and does not escalate when there is no CSSOM surface (node doubles)", () => {
    const r = applyStyleVerified({} as Element, "color", "red", { probe: basicProbe });
    expect(r.previewUnavailable).toBe(false);
  });
});

describe("layoutEditImpliesFlex — never convert a grid to flex (R2)", () => {
  it("returns false for grid / inline-grid / existing flex", () => {
    expect(layoutEditImpliesFlex("grid")).toBe(false);
    expect(layoutEditImpliesFlex("inline-grid")).toBe(false);
    expect(layoutEditImpliesFlex("flex")).toBe(false);
    expect(layoutEditImpliesFlex("inline-flex")).toBe(false);
  });
  it("returns true for a non-flex, non-grid element (and unknown display)", () => {
    expect(layoutEditImpliesFlex("block")).toBe(true);
    expect(layoutEditImpliesFlex(null)).toBe(true);
  });
});
