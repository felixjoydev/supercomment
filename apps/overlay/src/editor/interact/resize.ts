/**
 * U12 — pure resize math for the 8-point handles.
 *
 * Turns a pointer delta (in VIEWPORT px) on a given handle into new CSS
 * width/height (in CSS px), correcting for any accumulated ancestor scale so the
 * box tracks the pointer 1:1 on `transform: scale()` / zoomed sections. Shift
 * locks the aspect ratio; Alt resizes from the center (both sides move, so a
 * dimension changes by twice the delta). All arithmetic is guarded so a zero or
 * non-finite metric can never divide-by-zero or leak NaN into a recorded size.
 *
 * Pure + framework-free; the inspector/controller feed it the start metrics + the
 * gesture delta and apply/record the result.
 */

/** The eight resize handles (compass points). */
export type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export const HANDLES: readonly Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

export interface ResizeStart {
  /** The element's CSS width (offsetWidth), px. */
  width: number;
  /** The element's CSS height (offsetHeight), px. */
  height: number;
  /** The element's rendered width (getBoundingClientRect), viewport px. */
  rectWidth: number;
  /** The element's rendered height (getBoundingClientRect), viewport px. */
  rectHeight: number;
}

export interface ResizeModifiers {
  /** Shift: preserve the start aspect ratio. */
  aspect?: boolean;
  /** Alt/Option: resize symmetrically from the center. */
  center?: boolean;
}

export interface ResizeResult {
  width: number;
  height: number;
}

/** Smallest size we will ever record (px), so a box never collapses to 0/negative. */
const MIN_SIZE = 1;

/**
 * The scale of one axis (rendered / layout size), guarded: a zero or non-finite
 * layout size, or a non-positive/non-finite ratio, falls back to 1 (never divides
 * by zero, never propagates NaN).
 */
export function axisScale(rectSize: number, layoutSize: number): number {
  if (!Number.isFinite(rectSize) || !Number.isFinite(layoutSize) || layoutSize === 0) return 1;
  const s = rectSize / layoutSize;
  return Number.isFinite(s) && s > 0 ? s : 1;
}

const clampSize = (n: number): number =>
  Number.isFinite(n) ? Math.max(MIN_SIZE, Math.round(n)) : MIN_SIZE;

/** Does this handle change width / height? */
function handleAxes(handle: Handle): { x: -1 | 0 | 1; y: -1 | 0 | 1 } {
  const x = handle.includes("e") ? 1 : handle.includes("w") ? -1 : 0;
  const y = handle.includes("s") ? 1 : handle.includes("n") ? -1 : 0;
  return { x, y };
}

/**
 * Compute the new CSS width/height for a handle drag. `delta` is the pointer
 * movement in VIEWPORT px since the drag started.
 */
export function computeResize(
  handle: Handle,
  start: ResizeStart,
  delta: { x: number; y: number },
  mods: ResizeModifiers = {},
): ResizeResult {
  const sx = axisScale(start.rectWidth, start.width);
  const sy = axisScale(start.rectHeight, start.height);
  const { x: dirX, y: dirY } = handleAxes(handle);

  // Convert the viewport delta into CSS px along each active axis.
  const cssDx = (delta.x / sx) * dirX;
  const cssDy = (delta.y / sy) * dirY;
  // Center resize moves both sides, so a dimension changes by twice the delta.
  const factor = mods.center ? 2 : 1;

  let width = dirX !== 0 ? start.width + cssDx * factor : start.width;
  let height = dirY !== 0 ? start.height + cssDy * factor : start.height;

  if (mods.aspect && start.width > 0 && start.height > 0) {
    const ratio = start.width / start.height; // width per height
    const changesX = dirX !== 0;
    const changesY = dirY !== 0;
    if (changesX && changesY) {
      // Corner: drive by the axis that moved more (in CSS px), derive the other.
      if (Math.abs(width - start.width) >= Math.abs(height - start.height) * ratio) {
        height = width / ratio;
      } else {
        width = height * ratio;
      }
    } else if (changesX) {
      height = width / ratio; // edge on the x axis drives height
    } else if (changesY) {
      width = height * ratio; // edge on the y axis drives width
    }
  }

  return { width: clampSize(width), height: clampSize(height) };
}

export interface BoxMetrics {
  offsetWidth: number;
  offsetHeight: number;
  /** `getClientRects().length` — a single box fragment is required. */
  clientRectCount: number;
  /** The computed `display` value. */
  display: string;
}

/**
 * Resize handles apply ONLY when the target is a single box fragment with a real
 * width/height: `offsetWidth > 0`, exactly one client rect, and a `display` that
 * generates a resizable box (not `inline` / `contents`). Otherwise the handles
 * are suppressed and resize stays panel-input-only.
 */
export function resizeApplicable(m: BoxMetrics): boolean {
  return (
    Number.isFinite(m.offsetWidth) &&
    m.offsetWidth > 0 &&
    m.clientRectCount === 1 &&
    m.display !== "inline" &&
    m.display !== "contents"
  );
}
