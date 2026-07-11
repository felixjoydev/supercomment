import { describe, it, expect } from "vitest";

import type { ChangeOp } from "@supercomment/shared";

import { HistoryEngine } from "./history.js";
import { basicProbe } from "./color/normalize.js";

let n = 0;
function styleOp(o: {
  property: string;
  after: string;
  before?: string | null;
  selector?: string;
  responsive?: ChangeOp["responsive"];
}): ChangeOp {
  return {
    opId: `op-${n++}`,
    type: "setStyle",
    target: { selector: o.selector ?? "h1.hero", anchors: [] },
    property: o.property,
    before: o.before ?? null,
    after: o.after,
    ...(o.responsive ? { responsive: o.responsive } : {}),
  };
}

/**
 * A tiny DOM-effect world: a value per key and the EditDom closures that mutate
 * it, so undo/redo/revert can be asserted without a browser.
 */
function makeWorld() {
  const value: Record<string, string> = {};
  const build: Record<string, string> = {};
  const engine = new HistoryEngine({ probe: basicProbe, cap: 150 });
  const edit = (
    prop: string,
    before: string,
    after: string,
    opts: { mergeable?: boolean; selector?: string } = {},
  ): ChangeOp => {
    const domKey = `${opts.selector ?? "h1.hero"}|${prop}`;
    if (!(domKey in build)) build[domKey] = before; // first edit establishes build
    value[domKey] = after; // the authoring surface has already written
    const buildVal = build[domKey]!;
    const op = styleOp({ property: prop, before, after, selector: opts.selector });
    engine.record(
      op,
      {
        apply: () => {
          value[domKey] = after;
        },
        invert: () => {
          value[domKey] = before;
        },
        revertToBuild: () => {
          value[domKey] = buildVal;
        },
      },
      { mergeable: opts.mergeable },
    );
    return op;
  };
  return { engine, value, build, edit };
}

describe("HistoryEngine — projection", () => {
  it("coalesces by key and preserves the original build before", () => {
    const { engine, edit } = makeWorld();
    edit("font-size", "16px", "24px");
    edit("font-size", "24px", "32px");
    const ops = engine.projectOps();
    expect(ops).toHaveLength(1);
    expect(ops[0]!.before).toBe("16px"); // build value, not the intermediate 24px
    expect(ops[0]!.after).toBe("32px");
  });

  it("drops a numeric edit that nets back to its original", () => {
    const { engine, edit } = makeWorld();
    edit("font-size", "16px", "24px");
    edit("font-size", "24px", "16px");
    expect(engine.isEmpty()).toBe(true);
    expect(engine.size).toBe(0);
  });

  it("drops a colour edit re-picked to the original in a different syntax (normalized equal-drop)", () => {
    const { engine, edit } = makeWorld();
    edit("color", "rgb(0, 0, 0)", "rgb(255, 0, 0)");
    edit("color", "rgb(255, 0, 0)", "#000000"); // back to the build colour via hex
    expect(engine.isEmpty()).toBe(true);
  });

  it("keeps distinct keys apart", () => {
    const { engine, edit } = makeWorld();
    edit("font-size", "16px", "24px");
    edit("color", "black", "blue", { selector: "p.lead" });
    expect(engine.size).toBe(2);
  });

  it("coalesced moves net to the true original origin (order.from = first index, U5)", () => {
    const engine = new HistoryEngine({ probe: basicProbe });
    const noop = { apply: () => {}, invert: () => {}, revertToBuild: () => {} };
    const moveOp = (from: number, to: number): ChangeOp => ({
      opId: `m-${from}-${to}`,
      type: "moveNode",
      target: { selector: ".card", anchors: [] },
      insertion: { position: "before" },
      order: { from, to },
    });
    engine.record(moveOp(2, 1), noop); // 2 → 1
    engine.record(moveOp(1, 0), noop); // then 1 → 0
    const ops = engine.projectOps();
    expect(ops).toHaveLength(1);
    expect(ops[0]!.order).toEqual({ from: 2, to: 0 }); // origin stays the true 2
  });
});

describe("HistoryEngine — undo / redo", () => {
  it("steps through two gesture entries and redoes them", () => {
    const { engine, edit, value } = makeWorld();
    // Gesture 1: scrub 16 → 20.
    engine.beginGesture();
    edit("font-size", "16px", "18px");
    edit("font-size", "18px", "20px");
    engine.commitGesture();
    // Gesture 2: scrub 20 → 24.
    engine.beginGesture();
    edit("font-size", "20px", "22px");
    edit("font-size", "22px", "24px");
    engine.commitGesture();

    expect(value["h1.hero|font-size"]).toBe("24px");
    expect(engine.projectOps()[0]!.before).toBe("16px");
    expect(engine.projectOps()[0]!.after).toBe("24px");

    engine.undo();
    expect(value["h1.hero|font-size"]).toBe("20px");
    engine.undo();
    expect(value["h1.hero|font-size"]).toBe("16px");
    expect(engine.isEmpty()).toBe(true);

    engine.redo();
    expect(value["h1.hero|font-size"]).toBe("20px");
    engine.redo();
    expect(value["h1.hero|font-size"]).toBe("24px");
  });

  it("clears the redo stack when a new edit lands after an undo", () => {
    const { engine, edit } = makeWorld();
    edit("font-size", "16px", "24px");
    engine.undo();
    expect(engine.canRedo()).toBe(true);
    edit("color", "black", "blue");
    expect(engine.canRedo()).toBe(false);
  });

  it("merges repeated mergeable nudges into a single undo step", () => {
    const { engine, edit } = makeWorld();
    edit("font-size", "16px", "17px", { mergeable: true });
    edit("font-size", "17px", "18px", { mergeable: true });
    edit("font-size", "18px", "19px", { mergeable: true });
    // One projection op, and one undo takes it all the way back to build.
    expect(engine.size).toBe(1);
    engine.undo();
    expect(engine.isEmpty()).toBe(true);
    expect(engine.canRedo()).toBe(true);
  });
});

describe("HistoryEngine — edits list, revert, discard (AE7)", () => {
  it("lists five edits across two elements; reverting the third reverts only it", () => {
    const { engine, edit } = makeWorld();
    edit("font-size", "16px", "24px", { selector: "h1" });
    edit("color", "black", "blue", { selector: "h1" });
    const third = edit("width", "100px", "200px", { selector: "div" });
    edit("height", "50px", "80px", { selector: "div" });
    edit("gap", "8px", "16px", { selector: "h1" });

    const rows = engine.entries();
    expect(rows).toHaveLength(5);

    engine.revertKey(rows.find((r) => r.op.property === "width")!.key);
    const after = engine.entries();
    expect(after).toHaveLength(4);
    expect(after.some((r) => r.op.property === "width")).toBe(false);
    expect(after.some((r) => r.op.property === "color")).toBe(true);
    void third;
  });

  it("Discard all restores the pristine page (count 0), and is itself undoable", () => {
    const { engine, edit, value } = makeWorld();
    edit("font-size", "16px", "24px");
    edit("color", "black", "blue");
    engine.discardAll();
    expect(engine.size).toBe(0);
    expect(value["h1.hero|font-size"]).toBe("16px");
    expect(value["h1.hero|color"]).toBe("black");
    // Undoing the discard re-applies every reverted edit.
    engine.undo();
    expect(engine.size).toBe(2);
    expect(value["h1.hero|font-size"]).toBe("24px");
  });

  it("a per-edit revert is undoable (re-applies that edit)", () => {
    const { engine, edit, value } = makeWorld();
    edit("font-size", "16px", "24px");
    engine.revertKey(engine.entries()[0]!.key);
    expect(value["h1.hero|font-size"]).toBe("16px");
    engine.undo();
    expect(value["h1.hero|font-size"]).toBe("24px");
    expect(engine.size).toBe(1);
  });
});

describe("HistoryEngine — cap + reset", () => {
  it("keeps the projection before build-true even after the undo cap evicts old steps", () => {
    const value: Record<string, string> = {};
    const engine = new HistoryEngine({ probe: basicProbe, cap: 2 });
    const mk = (before: string, after: string): void => {
      value["fs"] = after;
      engine.record(
        styleOp({ property: "font-size", before, after }),
        {
          apply: () => (value["fs"] = after),
          invert: () => (value["fs"] = before),
          revertToBuild: () => (value["fs"] = "16px"),
        },
        {},
      );
    };
    mk("16px", "18px");
    mk("18px", "20px");
    mk("20px", "22px"); // cap 2 → the first step is evicted
    expect(engine.projectOps()[0]!.before).toBe("16px");
    engine.discardAll();
    expect(value["fs"]).toBe("16px"); // baseline revert survived the cap eviction
  });

  it("resetToBuild reverts the DOM and clears everything (non-undoable)", () => {
    const { engine, edit, value } = makeWorld();
    edit("font-size", "16px", "24px");
    engine.resetToBuild();
    expect(value["h1.hero|font-size"]).toBe("16px");
    expect(engine.isEmpty()).toBe(true);
    expect(engine.canUndo()).toBe(false);
  });
});

describe("HistoryEngine — events", () => {
  it("notifies subscribers on record and undo", () => {
    let count = 0;
    const engine = new HistoryEngine({ probe: basicProbe });
    engine.subscribe(() => count++);
    engine.record(
      styleOp({ property: "font-size", before: "16px", after: "24px" }),
      { apply: () => {}, invert: () => {}, revertToBuild: () => {} },
      {},
    );
    engine.undo();
    expect(count).toBeGreaterThanOrEqual(2);
  });
});
