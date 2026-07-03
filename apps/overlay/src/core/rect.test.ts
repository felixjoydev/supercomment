import { describe, it, expect } from "vitest";

import { toRect } from "./rect.js";

describe("toRect", () => {
  it("prefers x/y when present", () => {
    expect(toRect({ x: 1, y: 2, left: 9, top: 9, width: 3, height: 4 })).toEqual({
      x: 1,
      y: 2,
      width: 3,
      height: 4,
    });
  });

  it("falls back to left/top when x/y are absent", () => {
    expect(
      toRect({ left: 5, top: 6, width: 3, height: 4 } as {
        left: number;
        top: number;
        width: number;
        height: number;
      }),
    ).toEqual({ x: 5, y: 6, width: 3, height: 4 });
  });
});
