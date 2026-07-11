/**
 * U13 — drag-to-reorder slot resolution.
 *
 * Given a dragged element's SIBLINGS (their viewport rects + a little computed
 * context) and the pointer position, decides where a drop would land: the true
 * DOM index to insert at, the reference sibling + before/after, and the rect for
 * the insertion line. The container's resolved flow axis picks the geometry: a
 * row compares along x, a column along y, and grid / wrapped-flex use 2D
 * nearest-edge so a card can slot on either axis.
 *
 * Two rules from the plan are enforced here:
 *   - Slot candidates are IN-FLOW, box-generating siblings only — the dragged
 *     element itself, absolutely/fixed-positioned siblings, `display:none` /
 *     `display:contents`, and zero-area rects are excluded, since none defines a
 *     real drop edge.
 *   - The recorded indices are TRUE DOM child indices (not positions in the
 *     filtered candidate list), so the resulting `moveNode` re-applies against the
 *     real DOM.
 *
 * Pure + framework-free; the inspector feeds it measured rects and turns the slot
 * into an insertion line + a recorded move.
 */
import type { LayoutAxis } from "../layout-context.js";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A raw sibling as measured by the caller (true DOM index + computed context). */
export interface RawSibling {
  /** Position among ALL parent children (true DOM index), not the filtered list. */
  index: number;
  rect: Rect | null;
  position: string;
  display: string;
}

/** An in-flow drop candidate (true DOM index + its rect). */
export interface Candidate {
  index: number;
  rect: Rect;
}

export interface Slot {
  /** True DOM index to insert BEFORE (=== the reference's index, or after when appending). */
  insertIndex: number;
  /** The reference sibling's DOM index (the drop anchor), or null when appending at the end. */
  referenceIndex: number | null;
  /** Insert before or after the reference. */
  position: "before" | "after";
  /** The insertion-line rect (viewport coords) to draw. */
  line: Rect;
}

/** Zero-area or unmeasured rects define no edge. */
function hasArea(rect: Rect | null): rect is Rect {
  return !!rect && rect.width > 0 && rect.height > 0;
}

/**
 * The in-flow, box-generating drop candidates (true DOM indices preserved).
 * Excludes the dragged element, out-of-flow siblings, and non-box displays.
 */
export function inFlowCandidates(siblings: RawSibling[], draggedIndex: number): Candidate[] {
  const out: Candidate[] = [];
  for (const s of siblings) {
    if (s.index === draggedIndex) continue;
    if (!hasArea(s.rect)) continue;
    const pos = s.position.toLowerCase();
    if (pos === "absolute" || pos === "fixed") continue;
    const disp = s.display.toLowerCase();
    if (disp === "none" || disp === "contents") continue;
    out.push({ index: s.index, rect: s.rect });
  }
  return out;
}

const centerX = (r: Rect): number => r.x + r.width / 2;
const centerY = (r: Rect): number => r.y + r.height / 2;

function inside(container: Rect, p: { x: number; y: number }): boolean {
  return (
    p.x >= container.x &&
    p.x <= container.x + container.width &&
    p.y >= container.y &&
    p.y <= container.y + container.height
  );
}

/**
 * Resolve where a drop at `point` would land, or null when there is no valid slot
 * (no candidates, or the pointer left the container — a non-sibling region, which
 * draws no line and drops as a no-op).
 */
export function resolveSlot(
  candidates: Candidate[],
  axis: LayoutAxis,
  point: { x: number; y: number },
  container: Rect,
): Slot | null {
  if (candidates.length === 0 || !inside(container, point)) return null;

  const nearest =
    axis === "grid"
      ? nearest2d(candidates, point)
      : nearestOnAxis(candidates, point, axis);
  const c = nearest.rect;

  if (axis === "column") {
    const before = point.y < centerY(c);
    return {
      insertIndex: before ? nearest.index : nearest.index + 1,
      referenceIndex: nearest.index,
      position: before ? "before" : "after",
      line: { x: c.x, y: before ? c.y : c.y + c.height, width: c.width, height: 2 },
    };
  }
  // row + grid: decide on the x axis, draw a vertical line on the chosen edge.
  const before = point.x < centerX(c);
  return {
    insertIndex: before ? nearest.index : nearest.index + 1,
    referenceIndex: nearest.index,
    position: before ? "before" : "after",
    line: { x: before ? c.x : c.x + c.width, y: c.y, width: 2, height: c.height },
  };
}

/** Nearest candidate by center distance along the flow's main axis. */
function nearestOnAxis(candidates: Candidate[], point: { x: number; y: number }, axis: LayoutAxis): Candidate {
  const coord = axis === "column" ? centerY : centerX;
  const target = axis === "column" ? point.y : point.x;
  let best = candidates[0]!;
  let bestDist = Math.abs(coord(best.rect) - target);
  for (const cand of candidates) {
    const d = Math.abs(coord(cand.rect) - target);
    if (d < bestDist) {
      best = cand;
      bestDist = d;
    }
  }
  return best;
}

/** Nearest candidate by 2D center distance (wrapped flex / grid). */
function nearest2d(candidates: Candidate[], point: { x: number; y: number }): Candidate {
  let best = candidates[0]!;
  let bestDist = Infinity;
  for (const cand of candidates) {
    const dx = centerX(cand.rect) - point.x;
    const dy = centerY(cand.rect) - point.y;
    const d = dx * dx + dy * dy;
    if (d < bestDist) {
      best = cand;
      bestDist = d;
    }
  }
  return best;
}
