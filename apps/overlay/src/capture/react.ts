import type { ReactContext } from "@supercomment/shared";

/**
 * React (Tier 2/3) best-effort context capture (U7).
 *
 * Walks the React fiber tree starting from a DOM node to recover the shared
 * `reactContextSchema` shape:
 *  - `componentPath` — chain of component display names from the root down to
 *    the nearest component (Tier 2 / "react-component").
 *  - `sourceFile` / `sourceLine` — JSX source location, WHEN AVAILABLE
 *    (Tier 3 / "react-source").
 *
 * Graceful degradation is the core requirement:
 *  - No React on the page (no `__reactFiber$*` / `__reactInternalInstance$*`
 *    key on the node) -> returns `null`; the caller stays generic-only.
 *  - React present but no `_debugSource` (React 19, SWC, Next App Router, prod)
 *    -> returns componentPath with `sourceFile`/`sourceLine` undefined.
 *  - React present WITH `_debugSource` (React 18 + Babel dev transform)
 *    -> returns componentPath AND file:line.
 *  - React present but no recoverable component name -> returns `null` (the
 *    shared schema requires componentPath to be non-empty).
 *
 * We hand-roll the fiber walk rather than depending on `bippy` so the injected
 * IIFE stays dependency-free. The technique (scan own-property names for the
 * versioned `__reactFiber$<hash>` / `__reactInternalInstance$<hash>` key, then
 * follow `_debugOwner`/`return`) is standard and works across React 18 and 19.
 *
 * VERIFY IN REAL ENV: jsdom has no real React. These functions are exercised in
 * tests via *mocked* fiber objects. The React-version degradation matrix
 * (React 18 + Babel dev => react-source; React 19 / SWC / Next App Router =>
 * react-component only; production builds => often generic, names minified)
 * must be confirmed against real apps. See react.test.ts notes.
 */

/** Prefixes React uses for the fiber back-reference on a DOM node. */
const FIBER_KEY_PREFIXES = ["__reactFiber$", "__reactInternalInstance$"];

/** Max number of fibers to traverse upward (guards against cycles). */
const MAX_FIBER_DEPTH = 200;

/** Minimal structural view of a React fiber node (the bits we read). */
export interface FiberLike {
  type?: unknown;
  elementType?: unknown;
  tag?: number;
  return?: FiberLike | null;
  _debugOwner?: FiberLike | null;
  _debugSource?: DebugSourceLike | null;
  stateNode?: unknown;
}

/** The `_debugSource` shape populated by the Babel JSX dev transform. */
export interface DebugSourceLike {
  fileName?: string;
  lineNumber?: number;
  columnNumber?: number;
}

/**
 * Locate the React fiber attached to {@link node}, if any. React stores it on
 * a property whose name is `__reactFiber$<hash>` (React 17+) or
 * `__reactInternalInstance$<hash>` (React 16). We scan own-property names for
 * the known prefixes since the hash is build-specific.
 */
export function findFiber(node: Element): FiberLike | null {
  let names: string[];
  try {
    names = Object.keys(node as unknown as Record<string, unknown>);
  } catch {
    return null;
  }
  for (const name of names) {
    for (const prefix of FIBER_KEY_PREFIXES) {
      if (name.startsWith(prefix)) {
        const fiber = (node as unknown as Record<string, unknown>)[name];
        if (fiber && typeof fiber === "object") {
          return fiber as FiberLike;
        }
      }
    }
  }
  return null;
}

/**
 * Capture React context for {@link node}. Returns `null` when no fiber is found
 * (non-React app) or no component name is recoverable, so the caller can stay
 * generic-only.
 */
export function captureReactContext(node: Element): ReactContext | null {
  const fiber = findFiber(node);
  if (!fiber) {
    return null;
  }

  const componentPath = buildComponentPath(fiber);
  if (componentPath.length === 0) {
    // The shared schema requires a non-empty componentPath; without any
    // recoverable name there is no meaningful React context to attach.
    return null;
  }

  const result: ReactContext = { componentPath };

  const source = findDebugSource(fiber);
  if (source) {
    if (source.fileName) {
      result.sourceFile = source.fileName;
    }
    if (typeof source.lineNumber === "number" && source.lineNumber > 0) {
      result.sourceLine = source.lineNumber;
    }
  }
  return result;
}

/**
 * Build the component display-name chain by walking up `_debugOwner` (the chain
 * of component fibers that rendered this node). Falls back to `return` when
 * `_debugOwner` is unavailable (it is stripped in production / some builds).
 * Host components (plain DOM tags, whose `type` is a string) are skipped.
 * Returned root-first.
 */
export function buildComponentPath(fiber: FiberLike): string[] {
  const names: string[] = [];
  const seen = new Set<FiberLike>();
  let current: FiberLike | null | undefined = fiber;
  let depth = 0;

  while (current && depth < MAX_FIBER_DEPTH) {
    if (seen.has(current)) {
      break;
    }
    seen.add(current);
    depth += 1;

    const name = displayNameOf(current);
    if (name) {
      // Built leaf-first; reversed at the end so the root comes first.
      names.push(name);
    }

    const next: FiberLike | null | undefined =
      current._debugOwner ?? current.return;
    current = next;
  }

  return names.reverse();
}

/**
 * Resolve a fiber's component display name. Host components (string `type`) and
 * anonymous components return undefined. Handles function/class components,
 * `forwardRef`, `memo`, and `displayName` overrides.
 */
export function displayNameOf(fiber: FiberLike): string | undefined {
  const type = fiber.type ?? fiber.elementType;
  if (!type) {
    return undefined;
  }
  // Host component (e.g. "div") — not a React component.
  if (typeof type === "string") {
    return undefined;
  }
  return nameFromComponentType(type);
}

function nameFromComponentType(type: unknown): string | undefined {
  if (typeof type === "function") {
    const fn = type as { displayName?: string; name?: string };
    return fn.displayName || fn.name || undefined;
  }
  if (type && typeof type === "object") {
    const obj = type as {
      displayName?: string;
      render?: unknown;
      type?: unknown;
    };
    if (obj.displayName) {
      return obj.displayName;
    }
    // forwardRef: { $$typeof, render }
    if (typeof obj.render === "function") {
      const r = obj.render as { displayName?: string; name?: string };
      return r.displayName || r.name || undefined;
    }
    // memo: { $$typeof, type }
    if (obj.type) {
      return nameFromComponentType(obj.type);
    }
  }
  return undefined;
}

/**
 * Find the nearest `_debugSource` walking up `_debugOwner`/`return`. Present
 * only under React-18 + Babel dev transform; absent under React 19 / SWC /
 * Next App Router (graceful degradation -> returns null).
 */
export function findDebugSource(fiber: FiberLike): DebugSourceLike | null {
  const seen = new Set<FiberLike>();
  let current: FiberLike | null | undefined = fiber;
  let depth = 0;

  while (current && depth < MAX_FIBER_DEPTH) {
    if (seen.has(current)) {
      break;
    }
    seen.add(current);
    depth += 1;

    if (current._debugSource && current._debugSource.fileName) {
      return current._debugSource;
    }

    current = current._debugOwner ?? current.return;
  }
  return null;
}
