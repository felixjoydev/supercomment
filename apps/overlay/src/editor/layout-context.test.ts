import { describe, it, expect } from "vitest";

import { resolveLayout, type ParentFlow } from "./layout-context.js";

const flow = (o: Partial<ParentFlow>): ParentFlow => ({
  display: null,
  flexDirection: null,
  direction: null,
  ...o,
});

const words = (f: ParentFlow) => resolveLayout(f).buttons.map((b) => `${b.dir > 0 ? "+" : "-"}${b.word}`);

describe("resolveLayout — orientation-correct arrange (R5)", () => {
  it("a horizontal flex row reads Move left / Move right", () => {
    const ctx = resolveLayout(flow({ display: "flex", flexDirection: "row" }));
    expect(ctx.axis).toBe("row");
    expect(words(flow({ display: "flex", flexDirection: "row" }))).toEqual(["-left", "+right"]);
    // -1 (earlier) = left, +1 (later) = right.
    expect(ctx.buttons.find((b) => b.dir === 1)!.word).toBe("right");
  });

  it("a flex column reads Move up / Move down", () => {
    expect(words(flow({ display: "flex", flexDirection: "column" }))).toEqual(["-up", "+down"]);
  });

  it("row-reverse flips left/right", () => {
    expect(words(flow({ display: "flex", flexDirection: "row-reverse" }))).toEqual([
      "-right",
      "+left",
    ]);
  });

  it("RTL flips a row's labels (earlier sibling is visually on the right)", () => {
    expect(words(flow({ display: "flex", flexDirection: "row", direction: "rtl" }))).toEqual([
      "-right",
      "+left",
    ]);
  });

  it("row-reverse AND rtl cancel back to left/right", () => {
    expect(
      words(flow({ display: "flex", flexDirection: "row-reverse", direction: "rtl" })),
    ).toEqual(["-left", "+right"]);
  });

  it("a grid offers both axes", () => {
    const ctx = resolveLayout(flow({ display: "grid" }));
    expect(ctx.axis).toBe("grid");
    expect(ctx.buttons.map((b) => b.word)).toEqual(["left", "right", "up", "down"]);
  });

  it("a grid's horizontal pair flips under RTL", () => {
    const ctx = resolveLayout(flow({ display: "grid", direction: "rtl" }));
    expect(ctx.buttons.map((b) => b.word)).toEqual(["right", "left", "up", "down"]);
  });

  it("block flow (or an unresolved parent) falls back to vertical DOM order", () => {
    expect(words(flow({ display: "block" }))).toEqual(["-up", "+down"]);
    expect(words(flow({}))).toEqual(["-up", "+down"]); // no computed style
  });
});
