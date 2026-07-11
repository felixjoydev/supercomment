import { describe, it, expect } from "vitest";

import { EscapeStack, ESCAPE_PRIORITY } from "./escape-stack.js";

describe("EscapeStack", () => {
  it("closes only the innermost active layer", () => {
    const stack = new EscapeStack();
    const closed: string[] = [];
    let inlineActive = true;
    stack.register({
      priority: ESCAPE_PRIORITY.inlineText,
      isActive: () => inlineActive,
      close: () => {
        closed.push("inline");
        inlineActive = false;
      },
    });
    stack.register({
      priority: ESCAPE_PRIORITY.selection,
      isActive: () => true,
      close: () => closed.push("selection"),
    });

    expect(stack.handle()).toBe(true);
    expect(closed).toEqual(["inline"]); // inner only

    // Now inline is inactive → the next Escape falls through to selection.
    expect(stack.handle()).toBe(true);
    expect(closed).toEqual(["inline", "selection"]);
  });

  it("returns false when no layer is active", () => {
    const stack = new EscapeStack();
    stack.register({ priority: 10, isActive: () => false, close: () => {} });
    expect(stack.handle()).toBe(false);
  });

  it("does not close an unregistered layer", () => {
    const stack = new EscapeStack();
    let closed = false;
    const off = stack.register({
      priority: 10,
      isActive: () => true,
      close: () => {
        closed = true;
      },
    });
    off();
    expect(stack.handle()).toBe(false);
    expect(closed).toBe(false);
  });

  it("a throwing isActive/close never escapes", () => {
    const stack = new EscapeStack();
    stack.register({
      priority: 10,
      isActive: () => {
        throw new Error("boom");
      },
      close: () => {},
    });
    stack.register({
      priority: 20,
      isActive: () => true,
      close: () => {
        throw new Error("boom");
      },
    });
    expect(() => stack.handle()).not.toThrow();
  });
});
