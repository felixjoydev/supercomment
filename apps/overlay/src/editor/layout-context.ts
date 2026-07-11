/**
 * U5 — layout context for orientation-correct Arrange controls (R5).
 *
 * "Move up/down" is wrong in a horizontal row: the audited defect is that the
 * arrange buttons ignore the parent's real flow, so "up" moves an element LEFT in
 * a row. This resolves the parent container's flow — flex direction (with
 * reverse), grid, and writing direction (RTL) — into the correct directional
 * buttons, each mapped to a DOM-order step (-1 = earlier, +1 = later) so the live
 * preview and the saved re-apply move the element identically.
 *
 * The resolver is pure (takes the parent's computed flow) so it is unit-tested
 * without a browser; a real-DOM reader (`readParentFlow`) feeds it live values.
 */
import { readComputedValue } from "./style-edits.js";

export type LayoutAxis = "row" | "column" | "grid";

/** One arrange button: a DOM-order direction with an orientation-correct label. */
export interface ArrangeButton {
  /** DOM-order step: -1 = earlier sibling, +1 = later sibling. */
  dir: -1 | 1;
  label: string;
  /** The direction word ("up"/"down"/"left"/"right"), used for the CSS class + icon. */
  word: "up" | "down" | "left" | "right";
}

export interface LayoutContext {
  axis: LayoutAxis;
  rtl: boolean;
  buttons: ArrangeButton[];
}

/** The parent container's resolved flow (computed values; any may be null). */
export interface ParentFlow {
  display: string | null;
  flexDirection: string | null;
  direction: string | null;
}

function btn(dir: -1 | 1, word: ArrangeButton["word"]): ArrangeButton {
  const label = `Move ${word}`;
  return { dir, label, word };
}

/**
 * Resolve a parent's flow into orientation-correct arrange buttons. A grid offers
 * both axes; a flex row offers left/right (flipped by row-reverse and RTL); a flex
 * column offers up/down (flipped by column-reverse); anything else (normal block
 * flow, or an unmeasurable parent) falls back to vertical DOM order.
 */
export function resolveLayout(flow: ParentFlow): LayoutContext {
  const rtl = (flow.direction ?? "ltr").toLowerCase() === "rtl";
  const display = (flow.display ?? "").toLowerCase();

  if (display === "grid" || display === "inline-grid") {
    // Both axes; the horizontal pair flips under RTL. DOM-order steps either way
    // (true 2D placement is the drag-reorder in U13).
    const [earlierX, laterX]: [ArrangeButton["word"], ArrangeButton["word"]] = rtl ? ["right", "left"] : ["left", "right"];
    return {
      axis: "grid",
      rtl,
      buttons: [btn(-1, earlierX), btn(1, laterX), btn(-1, "up"), btn(1, "down")],
    };
  }

  if (display === "flex" || display === "inline-flex") {
    const fd = (flow.flexDirection ?? "row").toLowerCase();
    const reverse = fd.endsWith("reverse");
    if (fd.startsWith("column")) {
      const [earlier, later]: [ArrangeButton["word"], ArrangeButton["word"]] = reverse ? ["down", "up"] : ["up", "down"];
      return { axis: "column", rtl, buttons: [btn(-1, earlier), btn(1, later)] };
    }
    // Row: earlier = left, flipped by row-reverse XOR rtl.
    const flip = reverse !== rtl;
    const [earlier, later]: [ArrangeButton["word"], ArrangeButton["word"]] = flip ? ["right", "left"] : ["left", "right"];
    return { axis: "row", rtl, buttons: [btn(-1, earlier), btn(1, later)] };
  }

  // Block flow (or unresolved): DOM order reads top-to-bottom.
  return { axis: "column", rtl, buttons: [btn(-1, "up"), btn(1, "down")] };
}

/** Read a parent element's flow from computed style (real-env; nulls without it). */
export function readParentFlow(parent: Element): ParentFlow {
  return {
    display: readComputedValue(parent, "display"),
    flexDirection: readComputedValue(parent, "flex-direction"),
    direction: readComputedValue(parent, "direction"),
  };
}

/** Resolve the layout context for an element from its parent's live flow. */
export function layoutContextFor(el: Element): LayoutContext {
  const parent = el.parentElement;
  return resolveLayout(parent ? readParentFlow(parent) : { display: null, flexDirection: null, direction: null });
}
