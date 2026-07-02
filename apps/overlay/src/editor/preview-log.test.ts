import { describe, it, expect } from "vitest";

import { PreviewLog } from "./preview-log.js";

describe("PreviewLog", () => {
  it("reverts everything LIFO on revertAll and clears", () => {
    const log = new PreviewLog();
    const order: string[] = [];
    log.add("a", () => order.push("a"));
    log.add("b", () => order.push("b"));
    log.add("c", () => order.push("c"));
    expect(log.size).toBe(3);
    log.revertAll();
    expect(order).toEqual(["c", "b", "a"]); // last-applied reverts first
    expect(log.size).toBe(0);
  });

  it("first-write-wins per key: a re-edit keeps the ORIGINAL revert", () => {
    const log = new PreviewLog();
    const reverted: string[] = [];
    log.add("font-size", () => reverted.push("original"));
    log.add("font-size", () => reverted.push("second")); // ignored — key seen
    expect(log.size).toBe(1);
    log.revertAll();
    expect(reverted).toEqual(["original"]);
  });

  it("undoLast reverts + drops the most-recent preview and returns its key", () => {
    const log = new PreviewLog();
    const reverted: string[] = [];
    log.add("a", () => reverted.push("a"));
    log.add("b", () => reverted.push("b"));
    expect(log.undoLast()).toBe("b");
    expect(reverted).toEqual(["b"]);
    expect(log.size).toBe(1);
    expect(log.has("a")).toBe(true);
    expect(log.has("b")).toBe(false);
  });

  it("undoLast returns null when empty", () => {
    expect(new PreviewLog().undoLast()).toBeNull();
  });

  it("revertKey reverts + drops one specific preview (no-op when absent)", () => {
    const log = new PreviewLog();
    const reverted: string[] = [];
    log.add("a", () => reverted.push("a"));
    log.add("b", () => reverted.push("b"));
    log.revertKey("a");
    expect(reverted).toEqual(["a"]);
    expect(log.has("a")).toBe(false);
    expect(log.size).toBe(1);
    expect(() => log.revertKey("missing")).not.toThrow();
    expect(reverted).toEqual(["a"]);
  });

  it("swallows a throwing revert so it never reaches the host page", () => {
    const log = new PreviewLog();
    log.add("boom", () => {
      throw new Error("revert failed");
    });
    expect(() => log.revertAll()).not.toThrow();
    expect(log.size).toBe(0);
  });
});
