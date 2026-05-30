import { describe, it, expect } from "vitest";

import {
  captureReactContext,
  findFiber,
  buildComponentPath,
  displayNameOf,
  type FiberLike,
} from "./react.js";

/**
 * jsdom is unavailable in this sandbox and React is never present, so these
 * tests drive the fiber walk with *mocked* fiber objects that mimic the shapes
 * React attaches in dev/prod.
 *
 * VERIFY IN REAL ENV: the React-version degradation matrix must be confirmed
 * against real apps:
 *   - React 18 + Babel dev transform  -> _debugSource present -> source tier
 *   - React 19 / SWC / Next App Router -> _debugSource absent  -> component tier
 *   - production builds                -> names minified; often generic-only
 * jsdom/node cannot exercise real fiber attachment, hashed key generation, or
 * the Babel-vs-SWC transform difference.
 */

/** A node double exposing only what findFiber needs (own-property keys). */
function nodeWithFiber(fiber: FiberLike | null, hash = "abc123"): Element {
  const node: Record<string, unknown> = { tagName: "DIV" };
  if (fiber) {
    node[`__reactFiber$${hash}`] = fiber;
  }
  return node as unknown as Element;
}

/** Build a function component "type" with a display name. */
function comp(name: string): () => null {
  const fn = (): null => null;
  Object.defineProperty(fn, "name", { value: name });
  return fn;
}

describe("findFiber", () => {
  it("finds a fiber under a hashed __reactFiber$ key", () => {
    const fiber: FiberLike = { type: comp("Foo") };
    expect(findFiber(nodeWithFiber(fiber, "9z8y7x"))).toBe(fiber);
  });

  it("finds a fiber under the React 16 __reactInternalInstance$ key", () => {
    const fiber: FiberLike = { type: comp("Foo") };
    const node = { tagName: "DIV", __reactInternalInstance$qq: fiber };
    expect(findFiber(node as unknown as Element)).toBe(fiber);
  });

  it("returns null when no fiber key is present", () => {
    expect(findFiber(nodeWithFiber(null))).toBeNull();
  });
});

describe("displayNameOf", () => {
  it("reads function component names", () => {
    expect(displayNameOf({ type: comp("Card") })).toBe("Card");
  });

  it("prefers displayName over function name", () => {
    const fn = comp("Inner");
    (fn as unknown as { displayName: string }).displayName = "Outer";
    expect(displayNameOf({ type: fn })).toBe("Outer");
  });

  it("resolves forwardRef render names", () => {
    const render = comp("Button");
    const fwd = { $$typeof: Symbol.for("react.forward_ref"), render };
    expect(displayNameOf({ type: fwd })).toBe("Button");
  });

  it("unwraps memo to the inner type", () => {
    const memo = { $$typeof: Symbol.for("react.memo"), type: comp("Memoized") };
    expect(displayNameOf({ type: memo })).toBe("Memoized");
  });

  it("skips host components (string type)", () => {
    expect(displayNameOf({ type: "div" })).toBeUndefined();
  });
});

describe("buildComponentPath", () => {
  it("walks _debugOwner to build a root-first component path", () => {
    const app: FiberLike = { type: comp("App") };
    const card: FiberLike = { type: comp("Card"), _debugOwner: app };
    const button: FiberLike = { type: comp("Button"), _debugOwner: card };

    expect(buildComponentPath(button)).toEqual(["App", "Card", "Button"]);
  });

  it("falls back to `return` when _debugOwner is absent and skips host nodes", () => {
    const app: FiberLike = { type: comp("App") };
    const host: FiberLike = { type: "div", return: app };
    const leaf: FiberLike = { type: comp("Leaf"), return: host };

    expect(buildComponentPath(leaf)).toEqual(["App", "Leaf"]);
  });
});

describe("captureReactContext — tier resolution (graceful degradation)", () => {
  it("Tier 3 (source): fiber chain WITH _debugSource yields componentPath AND file:line", () => {
    const app: FiberLike = { type: comp("App") };
    const card: FiberLike = {
      type: comp("Card"),
      _debugOwner: app,
      _debugSource: { fileName: "src/Card.tsx", lineNumber: 42 },
    };

    const ctx = captureReactContext(nodeWithFiber(card))!;
    expect(ctx.componentPath).toEqual(["App", "Card"]);
    expect(ctx.sourceFile).toBe("src/Card.tsx");
    expect(ctx.sourceLine).toBe(42);
  });

  it("Tier 2 (component): fiber chain WITHOUT _debugSource yields componentPath only", () => {
    const app: FiberLike = { type: comp("App") };
    const widget: FiberLike = { type: comp("Widget"), _debugOwner: app };

    const ctx = captureReactContext(nodeWithFiber(widget))!;
    expect(ctx.componentPath).toEqual(["App", "Widget"]);
    expect(ctx.sourceFile).toBeUndefined();
    expect(ctx.sourceLine).toBeUndefined();
  });

  it("Tier 1 (generic-only): no fiber yields null", () => {
    expect(captureReactContext(nodeWithFiber(null))).toBeNull();
  });

  it("yields null when a fiber exists but no component name is recoverable", () => {
    // Only host components in the chain -> empty componentPath -> null (schema
    // requires a non-empty componentPath).
    const host: FiberLike = { type: "div" };
    expect(captureReactContext(nodeWithFiber(host))).toBeNull();
  });

  it("finds _debugSource higher up the chain when the leaf lacks it", () => {
    const app: FiberLike = {
      type: comp("App"),
      _debugSource: { fileName: "src/App.tsx", lineNumber: 7 },
    };
    const leaf: FiberLike = { type: comp("Leaf"), _debugOwner: app };

    const ctx = captureReactContext(nodeWithFiber(leaf))!;
    expect(ctx.sourceFile).toBe("src/App.tsx");
    expect(ctx.sourceLine).toBe(7);
  });
});
