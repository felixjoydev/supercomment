import type { SelectionTarget } from "./types.js";

/**
 * The "primary" element of a selection — the one selectors, computed styles,
 * surrounding HTML, anchors, and the "before" artifact are built from. `text`
 * and `area` selections have no element (region-only), so this returns null and
 * callers degrade to a region-only context.
 */
export function primaryElementOf(target: SelectionTarget): Element | null {
  switch (target.kind) {
    case "element":
      return target.element;
    case "multi":
      return target.elements[0] ?? null;
    case "text":
    case "area":
      return null;
  }
}
