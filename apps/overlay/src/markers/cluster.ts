/**
 * Marker clustering + off-screen detection (pure logic, no DOM).
 *
 * Markers that fall within `thresholdPx` of each other collapse into a single
 * count badge so a dense page does not become an unreadable pile of pins
 * (design-lens D-11). Off-screen markers are surfaced separately so the shell
 * can draw an edge indicator pointing at them (design-lens D-17).
 */
import type { Rect } from "../core/types.js";
import { centerOf, distanceBetween, isOutsideViewport } from "../core/geometry.js";

/** Default distance (CSS px, viewport space) under which markers cluster. */
export const DEFAULT_CLUSTER_THRESHOLD_PX = 36;

/** A single placed marker, anchored to a comment number. */
export interface MarkerInput {
  /** Stable per-preview comment number shown on the pin (R13). */
  number: number;
  /** The target rect in viewport coordinates. */
  rect: Rect;
}

/** A rendered marker: either a single pin or a collapsed cluster badge. */
export interface MarkerCluster {
  /** Numbers represented by this rendered item (1 = single pin). */
  numbers: number[];
  /** Viewport-space point where the pin/badge is drawn. */
  point: { x: number; y: number };
  /** True when more than one marker collapsed into this badge. */
  isCluster: boolean;
}

/**
 * Greedy single-pass clustering: walk markers, and fold each into an existing
 * cluster whose representative center is within `thresholdPx`, else start a new
 * cluster. Order-stable and deterministic — good enough for review pins and
 * easy to reason about in tests.
 */
export function clusterMarkers(
  markers: MarkerInput[],
  thresholdPx: number = DEFAULT_CLUSTER_THRESHOLD_PX,
): MarkerCluster[] {
  const clusters: { numbers: number[]; rects: Rect[] }[] = [];

  for (const marker of markers) {
    let placed = false;
    for (const cluster of clusters) {
      const representative = cluster.rects[0];
      if (representative && distanceBetween(representative, marker.rect) <= thresholdPx) {
        cluster.numbers.push(marker.number);
        cluster.rects.push(marker.rect);
        placed = true;
        break;
      }
    }
    if (!placed) {
      clusters.push({ numbers: [marker.number], rects: [marker.rect] });
    }
  }

  return clusters.map((cluster) => {
    const first = cluster.rects[0] as Rect;
    return {
      numbers: cluster.numbers,
      point: centerOf(first),
      isCluster: cluster.numbers.length > 1,
    };
  });
}

/** An off-screen marker plus the direction to point its edge indicator. */
export interface OffscreenMarker {
  number: number;
  point: { x: number; y: number };
}

/**
 * Split markers into the ones currently visible in the viewport and the ones
 * that scrolled off-screen. Visible markers get clustered; off-screen ones get
 * an edge indicator drawn by the shell.
 */
export function partitionByViewport(
  markers: MarkerInput[],
  viewport: { width: number; height: number },
): { visible: MarkerInput[]; offscreen: OffscreenMarker[] } {
  const visible: MarkerInput[] = [];
  const offscreen: OffscreenMarker[] = [];
  for (const marker of markers) {
    const point = centerOf(marker.rect);
    if (isOutsideViewport(point, viewport)) {
      offscreen.push({ number: marker.number, point });
    } else {
      visible.push(marker);
    }
  }
  return { visible, offscreen };
}
