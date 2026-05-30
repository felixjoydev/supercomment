/**
 * Pure geometry helpers used by markers (clustering, off-screen detection) and
 * by the selection modes (union rects, edge-aware form placement). No DOM here
 * so this is trivially unit-testable.
 */
import type { Rect } from "./types.js";

/** Center point of a rect. */
export function centerOf(rect: Rect): { x: number; y: number } {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/** Euclidean distance between the centers of two rects. */
export function distanceBetween(a: Rect, b: Rect): number {
  const ca = centerOf(a);
  const cb = centerOf(b);
  return Math.hypot(ca.x - cb.x, ca.y - cb.y);
}

/** Smallest rect that contains all of `rects`. Throws on an empty list. */
export function unionRect(rects: Rect[]): Rect {
  if (rects.length === 0) {
    throw new Error("unionRect requires at least one rect");
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** True when `point` lies outside `viewport` (an off-screen marker). */
export function isOutsideViewport(
  point: { x: number; y: number },
  viewport: { width: number; height: number },
): boolean {
  return (
    point.x < 0 ||
    point.y < 0 ||
    point.x > viewport.width ||
    point.y > viewport.height
  );
}

/**
 * Compass-style direction from the viewport center to an off-screen point,
 * used to render the edge indicator that points at the marker.
 */
export type EdgeDirection =
  | "top"
  | "bottom"
  | "left"
  | "right"
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

export function edgeDirection(
  point: { x: number; y: number },
  viewport: { width: number; height: number },
): EdgeDirection {
  const vertical =
    point.y < 0 ? "top" : point.y > viewport.height ? "bottom" : "";
  const horizontal =
    point.x < 0 ? "left" : point.x > viewport.width ? "right" : "";
  if (vertical && horizontal) {
    return `${vertical}-${horizontal}` as EdgeDirection;
  }
  return (vertical || horizontal || "top") as EdgeDirection;
}
