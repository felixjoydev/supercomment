import { describe, it, expect } from "vitest";

import { computeResize, axisScale, resizeApplicable, HANDLES, type ResizeStart } from "./resize.js";

/** An unscaled 200x100 box (rect == layout). */
const box = (over: Partial<ResizeStart> = {}): ResizeStart => ({
  width: 200,
  height: 100,
  rectWidth: 200,
  rectHeight: 100,
  ...over,
});

describe("axisScale (U12)", () => {
  it("computes rendered/layout, guarding zero + non-finite to 1", () => {
    expect(axisScale(100, 200)).toBe(0.5);
    expect(axisScale(200, 0)).toBe(1); // layout 0 -> no divide by zero
    expect(axisScale(NaN, 200)).toBe(1);
    expect(axisScale(-50, 200)).toBe(1); // non-positive ratio -> 1
  });
});

describe("computeResize (U12)", () => {
  it("drags an edge in CSS px, correcting for ancestor scale", () => {
    // Under a 0.5 ancestor scale, +100 viewport px on the east edge = +200 CSS px.
    const scaled = box({ rectWidth: 100, rectHeight: 50 }); // scale 0.5 on both axes
    expect(computeResize("e", scaled, { x: 100, y: 0 })).toEqual({ width: 400, height: 100 });
  });

  it("west edge grows the box when dragged left", () => {
    expect(computeResize("w", box(), { x: -30, y: 0 })).toEqual({ width: 230, height: 100 });
  });

  it("north/south edges drive height", () => {
    expect(computeResize("s", box(), { x: 0, y: 40 })).toEqual({ width: 200, height: 140 });
    expect(computeResize("n", box(), { x: 0, y: 25 })).toEqual({ width: 200, height: 75 });
  });

  it("center resize (Alt) changes a dimension by twice the delta", () => {
    expect(computeResize("e", box(), { x: 20, y: 0 }, { center: true })).toEqual({
      width: 240,
      height: 100,
    });
  });

  it("Shift locks the aspect ratio on a corner drag", () => {
    // 200x100 (ratio 2:1). Drag SE by +100 x — height follows to keep 2:1.
    const r = computeResize("se", box(), { x: 100, y: 10 }, { aspect: true });
    expect(r.width / r.height).toBeCloseTo(2, 5);
    expect(r.width).toBe(300);
    expect(r.height).toBe(150);
  });

  it("Shift on an x-edge derives height from the ratio", () => {
    const r = computeResize("e", box(), { x: 100, y: 0 }, { aspect: true });
    expect(r).toEqual({ width: 300, height: 150 });
  });

  it("never records below the 1px minimum or a NaN", () => {
    expect(computeResize("w", box(), { x: 500, y: 0 })).toEqual({ width: 1, height: 100 });
    const zero = box({ width: 0, rectWidth: 0 }); // scale guards to 1
    const r = computeResize("e", zero, { x: 10, y: 0 });
    expect(Number.isFinite(r.width)).toBe(true);
    expect(r.width).toBeGreaterThanOrEqual(1);
  });

  it("exposes all eight handles", () => {
    expect(HANDLES).toHaveLength(8);
    expect([...HANDLES].sort()).toEqual(["e", "n", "ne", "nw", "s", "se", "sw", "w"]);
  });
});

describe("resizeApplicable (U12)", () => {
  it("allows a single-fragment block box", () => {
    expect(
      resizeApplicable({ offsetWidth: 200, offsetHeight: 100, clientRectCount: 1, display: "block" }),
    ).toBe(true);
  });

  it("suppresses handles for inline, display:contents, multi-rect, and zero-width", () => {
    expect(
      resizeApplicable({ offsetWidth: 200, offsetHeight: 20, clientRectCount: 1, display: "inline" }),
    ).toBe(false);
    expect(
      resizeApplicable({ offsetWidth: 0, offsetHeight: 0, clientRectCount: 1, display: "contents" }),
    ).toBe(false);
    expect(
      resizeApplicable({ offsetWidth: 200, offsetHeight: 40, clientRectCount: 2, display: "inline" }),
    ).toBe(false); // wrapped inline anchor: multiple client rects
    expect(
      resizeApplicable({ offsetWidth: 0, offsetHeight: 100, clientRectCount: 1, display: "block" }),
    ).toBe(false);
  });
});
