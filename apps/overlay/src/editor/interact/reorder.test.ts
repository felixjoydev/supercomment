import { describe, it, expect } from "vitest";

import { inFlowCandidates, resolveSlot, type RawSibling, type Rect } from "./reorder.js";

const r = (x: number, y: number, w: number, h: number): Rect => ({ x, y, width: w, height: h });

describe("inFlowCandidates (U13)", () => {
  it("keeps in-flow box siblings with their TRUE DOM indices, drops the dragged", () => {
    const sibs: RawSibling[] = [
      { index: 0, rect: r(0, 0, 100, 50), position: "static", display: "block" },
      { index: 1, rect: r(100, 0, 100, 50), position: "static", display: "block" }, // dragged
      { index: 2, rect: r(200, 0, 100, 50), position: "static", display: "block" },
    ];
    const out = inFlowCandidates(sibs, 1);
    expect(out.map((c) => c.index)).toEqual([0, 2]); // 1 (dragged) removed, indices preserved
  });

  it("excludes absolute/fixed, display:none/contents, and zero-area siblings", () => {
    const sibs: RawSibling[] = [
      { index: 0, rect: r(0, 0, 100, 50), position: "static", display: "block" },
      { index: 1, rect: r(0, 0, 100, 50), position: "absolute", display: "block" },
      { index: 2, rect: r(0, 0, 100, 50), position: "static", display: "none" },
      { index: 3, rect: r(0, 0, 100, 50), position: "static", display: "contents" },
      { index: 4, rect: r(0, 0, 0, 0), position: "static", display: "block" },
      { index: 5, rect: null, position: "static", display: "block" },
      { index: 6, rect: r(300, 0, 100, 50), position: "static", display: "flex" },
    ];
    // Only true DOM indices 0 and 6 are real drop edges.
    expect(inFlowCandidates(sibs, -1).map((c) => c.index)).toEqual([0, 6]);
  });
});

describe("resolveSlot (U13)", () => {
  // A row of 3 cards at x = 0, 100, 200 (each 100 wide, 50 tall) in a 300x50 box.
  const rowCandidates = [
    { index: 0, rect: r(0, 0, 100, 50) },
    { index: 2, rect: r(100, 0, 100, 50) }, // index 1 was the dragged element
    { index: 3, rect: r(200, 0, 100, 50) },
  ];
  const rowContainer = r(0, 0, 300, 50);

  it("row: pointer left-of-center inserts BEFORE that card (true index)", () => {
    const slot = resolveSlot(rowCandidates, "row", { x: 120, y: 25 }, rowContainer)!;
    expect(slot).toMatchObject({ referenceIndex: 2, position: "before", insertIndex: 2 });
    expect(slot.line.x).toBe(100); // left edge of the card at x=100
    expect(slot.line.width).toBe(2); // a vertical line
  });

  it("row: pointer right-of-center inserts AFTER that card", () => {
    const slot = resolveSlot(rowCandidates, "row", { x: 180, y: 25 }, rowContainer)!;
    expect(slot).toMatchObject({ referenceIndex: 2, position: "after", insertIndex: 3 });
    expect(slot.line.x).toBe(200); // right edge of the card at x=100..200
  });

  it("column: decides on the y axis and draws a horizontal line", () => {
    const col = [
      { index: 0, rect: r(0, 0, 100, 50) },
      { index: 1, rect: r(0, 50, 100, 50) },
    ];
    const slot = resolveSlot(col, "column", { x: 50, y: 60 }, r(0, 0, 100, 100))!;
    expect(slot).toMatchObject({ referenceIndex: 1, position: "before", insertIndex: 1 });
    expect(slot.line.height).toBe(2); // horizontal line
    expect(slot.line.y).toBe(50);
  });

  it("grid / wrapped flex: 2D nearest card, side by x", () => {
    // 2x2 grid; pointer near the top-right card's left half.
    const grid = [
      { index: 0, rect: r(0, 0, 100, 100) },
      { index: 1, rect: r(100, 0, 100, 100) },
      { index: 2, rect: r(0, 100, 100, 100) },
      { index: 3, rect: r(100, 100, 100, 100) },
    ];
    const slot = resolveSlot(grid, "grid", { x: 120, y: 40 }, r(0, 0, 200, 200))!;
    expect(slot).toMatchObject({ referenceIndex: 1, position: "before", insertIndex: 1 });
  });

  it("returns null outside the container (non-sibling region → no line, no-op drop)", () => {
    expect(resolveSlot(rowCandidates, "row", { x: 400, y: 25 }, rowContainer)).toBeNull();
    expect(resolveSlot(rowCandidates, "row", { x: 50, y: 200 }, rowContainer)).toBeNull();
  });

  it("returns null when there are no candidates", () => {
    expect(resolveSlot([], "row", { x: 10, y: 10 }, rowContainer)).toBeNull();
  });
});
