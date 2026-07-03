import { describe, it, expect } from "vitest";

import { primaryElementOf } from "./target.js";
import type { SelectionTarget } from "./types.js";

const el = (id: string) => ({ id }) as unknown as Element;
// Only `.kind`/`.element`/`.elements` are read, so build minimal variants and
// cast through unknown (the full SelectionTarget variants also carry a `rect`).
const target = (t: object) => t as unknown as SelectionTarget;

describe("primaryElementOf", () => {
  it("returns the element for an element selection", () => {
    const e = el("a");
    expect(primaryElementOf(target({ kind: "element", element: e }))).toBe(e);
  });

  it("returns the first element of a multi selection (or null when empty)", () => {
    const e = el("first");
    expect(primaryElementOf(target({ kind: "multi", elements: [e, el("b")] }))).toBe(e);
    expect(primaryElementOf(target({ kind: "multi", elements: [] }))).toBeNull();
  });

  it("returns null for region-only text/area selections", () => {
    expect(primaryElementOf(target({ kind: "text" }))).toBeNull();
    expect(primaryElementOf(target({ kind: "area" }))).toBeNull();
  });
});
