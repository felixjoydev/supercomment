import { describe, it, expect } from "vitest";

import type { ChangeOp } from "@supercomment/shared";

import { EditSession, opKey } from "./edit-session.js";

let n = 0;
function styleOp(overrides: Partial<ChangeOp> = {}): ChangeOp {
  return {
    opId: `op-${n++}`,
    type: "setStyle",
    target: { selector: "h1.hero", anchors: [{ type: "id", value: "hero" }] },
    property: "font-size",
    before: "16px",
    after: "24px",
    ...overrides,
  };
}

function insertOp(opId: string): ChangeOp {
  return {
    opId,
    type: "insertNode",
    target: { selector: "section", anchors: [] },
    node: { tag: "button", text: "Buy" },
    insertion: { position: "append" },
  };
}

describe("opKey", () => {
  it("coalesces style edits by target+property, ignoring opId", () => {
    expect(opKey(styleOp({ opId: "a" }))).toBe(opKey(styleOp({ opId: "b" })));
  });

  it("distinguishes different properties", () => {
    expect(opKey(styleOp({ property: "color" }))).not.toBe(
      opKey(styleOp({ property: "font-size" })),
    );
  });

  it("distinguishes breakpoints and pseudo-states", () => {
    expect(opKey(styleOp({ responsive: "mobile" }))).not.toBe(
      opKey(styleOp({ responsive: "tablet" })),
    );
    expect(opKey(styleOp({ state: "hover" }))).not.toBe(
      opKey(styleOp({ state: "default" })),
    );
  });

  it("keeps every insertNode distinct (by opId)", () => {
    expect(opKey(insertOp("n1"))).not.toBe(opKey(insertOp("n2")));
  });
});

describe("EditSession", () => {
  it("records an edit and produces a change-set with the authored commit", () => {
    const s = new EditSession("commit-abc");
    s.record(styleOp());
    expect(s.size).toBe(1);
    const cs = s.toChangeSet();
    expect(cs?.ops).toHaveLength(1);
    expect(cs?.authoredCommit).toBe("commit-abc");
  });

  it("coalesces re-edits, preserving the ORIGINAL before-value", () => {
    const s = new EditSession();
    s.record(styleOp({ before: "16px", after: "24px" }));
    s.record(styleOp({ before: "24px", after: "32px" })); // reviewer nudges again
    expect(s.size).toBe(1);
    const op = s.list()[0];
    expect(op?.before).toBe("16px"); // original developer value, not 24px
    expect(op?.after).toBe("32px");
  });

  it("drops a value edit that returns to its original (net no-op)", () => {
    const s = new EditSession();
    s.record(styleOp({ before: "16px", after: "24px" }));
    s.record(styleOp({ before: "24px", after: "16px" })); // back to original
    expect(s.isEmpty()).toBe(true);
  });

  it("keeps distinct edits for different properties on the same target", () => {
    const s = new EditSession();
    s.record(styleOp({ property: "font-size", after: "24px" }));
    s.record(styleOp({ property: "color", before: "black", after: "blue" }));
    expect(s.size).toBe(2);
  });

  it("keeps per-breakpoint edits distinct", () => {
    const s = new EditSession();
    s.record(styleOp({ responsive: "mobile", after: "18px" }));
    s.record(styleOp({ responsive: "tablet", after: "24px" }));
    expect(s.size).toBe(2);
  });

  it("keeps every inserted node and never treats structural ops as no-ops", () => {
    const s = new EditSession();
    s.record(insertOp("n1"));
    s.record(insertOp("n2"));
    expect(s.size).toBe(2);
  });

  it("supports remove and discard", () => {
    const s = new EditSession();
    const op = styleOp();
    s.record(op);
    s.remove(op);
    expect(s.isEmpty()).toBe(true);

    s.record(styleOp({ property: "color", after: "red" }));
    s.record(styleOp({ property: "font-size", after: "20px" }));
    expect(s.size).toBe(2);
    s.discard();
    expect(s.isEmpty()).toBe(true);
    expect(s.toChangeSet()).toBeNull();
  });

  it("returns a null change-set when empty and omits authoredCommit when unset", () => {
    const s = new EditSession();
    expect(s.toChangeSet()).toBeNull();
    s.record(styleOp());
    expect(s.toChangeSet()?.authoredCommit).toBeUndefined();
  });

  it("has() reports whether an op's logical key is buffered", () => {
    const s = new EditSession();
    const op = styleOp({ property: "gap", after: "48px" });
    expect(s.has(op)).toBe(false);
    s.record(op);
    expect(s.has(op)).toBe(true);
    // Same logical key (target+property), different opId → still buffered.
    expect(s.has(styleOp({ property: "gap", opId: "other" }))).toBe(true);
  });

  it("undoLast() removes the most-recent distinct edit and returns it", () => {
    const s = new EditSession();
    s.record(styleOp({ property: "font-size", after: "24px" }));
    s.record(styleOp({ property: "color", before: "black", after: "blue" }));
    const undone = s.undoLast();
    expect(undone?.property).toBe("color");
    expect(s.size).toBe(1);
    expect(s.list()[0]?.property).toBe("font-size");
  });

  it("undoLast() steps back the most-recent ACTION (redo-capable history, U3)", () => {
    const s = new EditSession();
    s.record(styleOp({ property: "font-size", after: "24px" }));
    s.record(styleOp({ property: "color", after: "blue" }));
    s.record(styleOp({ property: "font-size", after: "40px" })); // re-edit
    // History is step-based now: the last ACTION was the font-size re-nudge, so
    // undo steps it back (to 24px) rather than removing the color edit.
    expect(s.undoLast()?.property).toBe("font-size");
    expect(s.list().find((o) => o.property === "font-size")?.after).toBe("24px");
    expect(s.list().find((o) => o.property === "color")?.after).toBe("blue");
  });

  it("undoLast() returns null on an empty buffer", () => {
    expect(new EditSession().undoLast()).toBeNull();
  });
});
