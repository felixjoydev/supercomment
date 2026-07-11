import { describe, it, expect, vi } from "vitest";

import { Gesture } from "./gesture.js";

describe("Gesture (U12)", () => {
  it("a press that crosses the activation distance becomes a drag (start → move → commit)", () => {
    const cb = { onStart: vi.fn(), onMove: vi.fn(), onCommit: vi.fn(), onTap: vi.fn() };
    const g = new Gesture(cb, { activationDistance: 5 });
    g.down({ x: 100, y: 100 });
    g.move({ x: 103, y: 101 }); // dist ~3.2 < 5 — not yet a drag
    expect(cb.onStart).not.toHaveBeenCalled();
    g.move({ x: 108, y: 100 }); // dist 8 >= 5 — activate
    expect(cb.onStart).toHaveBeenCalledWith({ x: 100, y: 100 });
    expect(cb.onMove).toHaveBeenLastCalledWith({ x: 108, y: 100 }, { x: 8, y: 0 });
    g.move({ x: 120, y: 130 });
    expect(cb.onMove).toHaveBeenLastCalledWith({ x: 120, y: 130 }, { x: 20, y: 30 });
    g.up({ x: 120, y: 130 });
    expect(cb.onCommit).toHaveBeenCalledWith({ x: 120, y: 130 }, { x: 20, y: 30 });
    expect(cb.onTap).not.toHaveBeenCalled();
  });

  it("a sub-threshold press-release is a TAP, not a drag (chrome pass-through)", () => {
    const cb = { onStart: vi.fn(), onCommit: vi.fn(), onTap: vi.fn() };
    const g = new Gesture(cb, { activationDistance: 5 });
    g.down({ x: 50, y: 50 });
    g.move({ x: 52, y: 51 }); // below threshold
    g.up({ x: 52, y: 51 });
    expect(cb.onStart).not.toHaveBeenCalled();
    expect(cb.onCommit).not.toHaveBeenCalled();
    expect(cb.onTap).toHaveBeenCalledWith({ x: 50, y: 50 });
  });

  it("cancel aborts a LIVE drag (no commit) and reports abort", () => {
    const cb = { onAbort: vi.fn(), onCommit: vi.fn() };
    const g = new Gesture(cb, { activationDistance: 5 });
    g.down({ x: 0, y: 0 });
    g.move({ x: 20, y: 0 }); // active
    expect(g.active).toBe(true);
    g.cancel();
    expect(cb.onAbort).toHaveBeenCalledOnce();
    expect(g.active).toBe(false);
    g.up({ x: 20, y: 0 }); // released after cancel — nothing fires
    expect(cb.onCommit).not.toHaveBeenCalled();
  });

  it("cancel before activation fires nothing (a press that never became a drag)", () => {
    const cb = { onAbort: vi.fn(), onTap: vi.fn() };
    const g = new Gesture(cb, { activationDistance: 5 });
    g.down({ x: 0, y: 0 });
    g.cancel();
    expect(cb.onAbort).not.toHaveBeenCalled();
  });

  it("ignores moves with no preceding down", () => {
    const cb = { onStart: vi.fn(), onMove: vi.fn() };
    const g = new Gesture(cb);
    g.move({ x: 100, y: 100 });
    expect(cb.onStart).not.toHaveBeenCalled();
    expect(cb.onMove).not.toHaveBeenCalled();
  });

  it("swallows a throwing callback (never propagates into the host page)", () => {
    const g = new Gesture({
      onStart: () => {
        throw new Error("boom");
      },
    });
    g.down({ x: 0, y: 0 });
    expect(() => g.move({ x: 20, y: 0 })).not.toThrow();
  });
});
