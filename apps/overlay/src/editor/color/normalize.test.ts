import { describe, it, expect } from "vitest";

import {
  parseBasicColor,
  rgbaToHex6,
  rgbaToHex8,
  rgbaToCss,
  isTransparent,
  canonicalColor,
  createCanvasProbe,
  basicProbe,
  type ColorProbe,
  type Rgba,
} from "./normalize.js";

describe("parseBasicColor", () => {
  it("parses rgb() and rgba()", () => {
    expect(parseBasicColor("rgb(255, 0, 128)")).toEqual({ r: 255, g: 0, b: 128, a: 1 });
    expect(parseBasicColor("rgba(0, 16, 32, 0.5)")).toEqual({ r: 0, g: 16, b: 32, a: 0.5 });
  });

  it("parses the modern space/slash rgb() form", () => {
    expect(parseBasicColor("rgb(10 20 30 / 0.25)")).toEqual({ r: 10, g: 20, b: 30, a: 0.25 });
  });

  it("parses #rgb, #rrggbb and #rrggbbaa", () => {
    expect(parseBasicColor("#abc")).toEqual({ r: 170, g: 187, b: 204, a: 1 });
    expect(parseBasicColor("#001020")).toEqual({ r: 0, g: 16, b: 32, a: 1 });
    expect(parseBasicColor("#ff000080")).toEqual({ r: 255, g: 0, b: 0, a: 0.502 });
  });

  it("treats transparent as alpha 0", () => {
    expect(parseBasicColor("transparent")).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it("returns null for modern colour syntaxes it does not understand (canvas probe covers those)", () => {
    expect(parseBasicColor("oklch(0.7 0.15 250)")).toBeNull();
    expect(parseBasicColor("not-a-colour")).toBeNull();
    expect(parseBasicColor(null)).toBeNull();
    expect(parseBasicColor("")).toBeNull();
  });
});

describe("rgba serialisers", () => {
  const c: Rgba = { r: 0, g: 16, b: 32, a: 0.5 };
  it("hex6 drops alpha, hex8 keeps it", () => {
    expect(rgbaToHex6(c)).toBe("#001020");
    expect(rgbaToHex8(c)).toBe("#00102080");
  });
  it("rgbaToCss picks rgb vs rgba by alpha", () => {
    expect(rgbaToCss({ r: 1, g: 2, b: 3, a: 1 })).toBe("rgb(1, 2, 3)");
    expect(rgbaToCss(c)).toBe("rgba(0, 16, 32, 0.5)");
  });
  it("isTransparent only for alpha 0", () => {
    expect(isTransparent({ r: 0, g: 0, b: 0, a: 0 })).toBe(true);
    expect(isTransparent({ r: 0, g: 0, b: 0, a: 0.01 })).toBe(false);
    expect(isTransparent(null)).toBe(false);
  });
});

describe("canonicalColor (via an injected probe)", () => {
  // Fake probe: an oklch string that resolves to the same pixels as an rgb string.
  const probe: ColorProbe = {
    toRgba(input) {
      if (input === "oklch(0.5 0.1 20)" || input === "rgb(140, 90, 90)") {
        return { r: 140, g: 90, b: 90, a: 1 };
      }
      if (input === "rgba(0,0,0,0)") return { r: 0, g: 0, b: 0, a: 0 };
      return null;
    },
  };

  it("canonicalizes equivalent syntaxes to the same string", () => {
    expect(canonicalColor("oklch(0.5 0.1 20)", probe)).toBe(
      canonicalColor("rgb(140, 90, 90)", probe),
    );
  });

  it("maps fully transparent to 'transparent', not #000000", () => {
    expect(canonicalColor("rgba(0,0,0,0)", probe)).toBe("transparent");
  });

  it("returns null for a non-colour", () => {
    expect(canonicalColor("garbage", probe)).toBeNull();
    expect(canonicalColor(null, probe)).toBeNull();
  });
});

describe("createCanvasProbe", () => {
  it("falls back to the basic probe when no canvas 2D context is available", () => {
    // The node double's createElement returns an element with no getContext.
    const fakeDoc = {
      createElement: () => ({ width: 0, height: 0 }),
    } as unknown as Document;
    const probe = createCanvasProbe(fakeDoc);
    expect(probe.toRgba("rgb(1, 2, 3)")).toEqual(basicProbe.toRgba("rgb(1, 2, 3)"));
    expect(probe.toRgba("oklch(0.7 0.15 250)")).toBeNull(); // fallback can't resolve it
  });
});
