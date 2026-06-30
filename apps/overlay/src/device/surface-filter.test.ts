import { describe, it, expect } from "vitest";

import {
  effectiveSurface,
  filterBySurface,
  countBySurface,
} from "./surface-filter.js";

const items = [
  { id: 1, surface: "web" as const },
  { id: 2, surface: "mobile" as const },
  { id: 3, surface: "mobile" as const },
  { id: 4, surface: "tablet" as const },
  { id: 5 }, // legacy / no surface
];

describe("effectiveSurface", () => {
  it("treats missing surface as web", () => {
    expect(effectiveSurface(undefined)).toBe("web");
    expect(effectiveSurface("mobile")).toBe("mobile");
  });
});

describe("filterBySurface", () => {
  it("keeps only the matching surface (legacy counts as web)", () => {
    expect(filterBySurface(items, "web").map((i) => i.id)).toEqual([1, 5]);
    expect(filterBySurface(items, "mobile").map((i) => i.id)).toEqual([2, 3]);
    expect(filterBySurface(items, "tablet").map((i) => i.id)).toEqual([4]);
  });
});

describe("countBySurface", () => {
  it("counts per surface with legacy as web", () => {
    expect(countBySurface(items)).toEqual({
      web: 2,
      mobile: 2,
      tablet: 1,
      responsive: 0,
    });
  });
});
