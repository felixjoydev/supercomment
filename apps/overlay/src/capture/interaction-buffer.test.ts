import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { interactionEventSchema } from "@supercomment/shared";

import {
  recordInteraction,
  getRecentInteractions,
  resetInteractionBuffer,
  compactSelector,
  describeInteractionTarget,
  isWithinOverlay,
} from "./interaction-buffer.js";
import { HOST_ELEMENT_ID } from "../shell/root.js";

/** Minimal element double for selector/value extraction. */
function fakeEl(attrs: Record<string, string>, value?: unknown) {
  return {
    tagName: attrs.tag ?? "DIV",
    id: attrs.id,
    getAttribute: (name: string) => attrs[name] ?? null,
    value,
  };
}

describe("compactSelector", () => {
  it("prefers id, then data-testid, then first class, then tag", () => {
    expect(compactSelector(fakeEl({ tag: "BUTTON", id: "buy" }))).toBe(
      "button#buy",
    );
    expect(
      compactSelector(fakeEl({ tag: "BUTTON", "data-testid": "cta" })),
    ).toBe('button[data-testid="cta"]');
    expect(compactSelector(fakeEl({ tag: "DIV", class: "card primary" }))).toBe(
      "div.card",
    );
    expect(compactSelector(fakeEl({ tag: "SPAN" }))).toBe("span");
  });

  it("returns undefined for non-elements", () => {
    expect(compactSelector(null)).toBeUndefined();
    expect(compactSelector({})).toBeUndefined();
  });
});

describe("describeInteractionTarget", () => {
  it("captures the target selector only — never the entered value", () => {
    const detail = describeInteractionTarget(
      fakeEl({ tag: "INPUT", id: "email", type: "text" }, "admin@example.com"),
    );
    expect(detail).toEqual({ target: "input#email" });
    expect("value" in detail).toBe(false);
  });
});

describe("isWithinOverlay", () => {
  it("flags the overlay host element", () => {
    expect(isWithinOverlay(fakeEl({ tag: "DIV", id: HOST_ELEMENT_ID }))).toBe(
      true,
    );
  });
  it("flags elements inside the overlay (via closest)", () => {
    const inside = {
      tagName: "BUTTON",
      closest: (sel: string) =>
        sel === `#${HOST_ELEMENT_ID}` ? {} : null,
    };
    expect(isWithinOverlay(inside)).toBe(true);
  });
  it("does not flag ordinary app elements", () => {
    expect(isWithinOverlay(fakeEl({ tag: "BUTTON", id: "buy" }))).toBe(false);
    expect(isWithinOverlay(null)).toBe(false);
  });
});

describe("interaction ring buffer", () => {
  beforeEach(() => resetInteractionBuffer());
  afterEach(() => resetInteractionBuffer());

  it("keeps only the most recent entries (default capacity 15)", () => {
    for (let i = 0; i < 20; i += 1) {
      recordInteraction("click", { target: `button#b${i}` });
    }
    const entries = getRecentInteractions();
    expect(entries.length).toBe(15);
    // oldest 5 evicted -> first remaining is b5
    expect(entries[0]?.target).toBe("button#b5");
    expect(entries.at(-1)?.target).toBe("button#b19");
    for (const e of entries) {
      expect(() => interactionEventSchema.parse(e)).not.toThrow();
      expect(e.value).toBeUndefined();
    }
  });

  it("returns a defensive copy", () => {
    recordInteraction("submit", { target: "form" });
    const a = getRecentInteractions();
    a[0]!.target = "mutated";
    expect(getRecentInteractions()[0]?.target).toBe("form");
  });
});
