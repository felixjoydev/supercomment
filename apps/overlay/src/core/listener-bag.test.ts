import { describe, it, expect } from "vitest";

import { createListenerBag, type ListenerTarget } from "./listener-bag.js";

/** A fake EventTarget that records bind/unbind calls. */
function fakeTarget() {
  const bound: Array<{ type: string; handler: EventListener }> = [];
  const target: ListenerTarget = {
    addEventListener(type, handler) {
      bound.push({ type, handler });
    },
    removeEventListener(type, handler) {
      const i = bound.findIndex((b) => b.type === type && b.handler === handler);
      if (i >= 0) bound.splice(i, 1);
    },
  };
  return { target, bound };
}

describe("createListenerBag", () => {
  it("removes every added listener on dispose", () => {
    const { target, bound } = fakeTarget();
    const bag = createListenerBag();
    bag.add(target, "resize", () => {});
    bag.add(target, "scroll", () => {});
    expect(bound).toHaveLength(2);
    bag.dispose();
    expect(bound).toHaveLength(0);
  });

  it("runs pushed teardown thunks and is idempotent", () => {
    const bag = createListenerBag();
    let count = 0;
    bag.push(() => (count += 1));
    bag.dispose();
    bag.dispose(); // second dispose is a no-op (already cleared)
    expect(count).toBe(1);
  });

  it("continues disposing even when one teardown throws (best-effort)", () => {
    const bag = createListenerBag();
    let ran = false;
    bag.push(() => {
      throw new Error("boom");
    });
    bag.push(() => {
      ran = true;
    });
    expect(() => bag.dispose()).not.toThrow();
    expect(ran).toBe(true);
  });
});
