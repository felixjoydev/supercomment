import type { Rect } from "./types.js";

/**
 * Normalize a DOMRect-ish (`{ x?, y?, left, top, width, height }`) to our plain
 * viewport-coordinate {@link Rect}. `x`/`y` fall back to `left`/`top` for
 * environments (and older Safari) that expose only the latter.
 */
export function toRect(r: {
  x?: number;
  y?: number;
  left: number;
  top: number;
  width: number;
  height: number;
}): Rect {
  return {
    x: r.x ?? r.left,
    y: r.y ?? r.top,
    width: r.width,
    height: r.height,
  };
}
