/**
 * Marker rendering into the shadow layer.
 *
 * Takes the placed markers, clusters the visible ones into pins/badges and
 * draws edge indicators for off-screen ones, then paints them into a dedicated
 * container. Pure clustering math lives in `cluster.ts`; this file only renders
 * the results, so it stays thin.
 */
import type { Rect } from "../core/types.js";
import {
  clusterMarkers,
  partitionByViewport,
  DEFAULT_CLUSTER_THRESHOLD_PX,
  type MarkerInput,
} from "./cluster.js";
import { edgeDirection } from "../core/geometry.js";
import { popIn } from "../shell/motion.js";

/** A placed comment marker, anchored to its target rect (viewport space). */
export interface PlacedMarker {
  number: number;
  rect: Rect;
  /**
   * U12: an EXISTING comment whose element could not be confidently re-anchored
   * on the current deploy is rendered in a visually distinct stale state (kept
   * visible). Fresh submits leave this undefined. U8 flips it from anchor
   * corroboration; for now it reflects the server-persisted is_stale flag.
   */
  isStale?: boolean;
}

export class MarkerLayer {
  private readonly container: HTMLElement;
  private readonly markers: PlacedMarker[] = [];
  /** Number of the marker added by the latest add(), so only IT pops in —
   * scroll/resize repaints must not replay entrance animations. */
  private justAdded: number | null = null;

  constructor(
    private readonly doc: Document,
    parent: HTMLElement,
    private readonly thresholdPx: number = DEFAULT_CLUSTER_THRESHOLD_PX,
  ) {
    this.container = doc.createElement("div");
    this.container.className = "sc-marker-container";
    parent.appendChild(this.container);
  }

  /** Register a new marker and repaint (the new pin pops in once). */
  add(marker: PlacedMarker): void {
    this.markers.push(marker);
    this.justAdded = marker.number;
    this.render();
    this.justAdded = null;
  }

  /**
   * U12: register MANY existing comments at once (loaded back on activate) and
   * repaint once. Unlike add(), these do NOT pop in — they are pre-existing, not
   * freshly created — and any marked stale renders in a distinct state.
   */
  addMany(markers: PlacedMarker[]): void {
    if (markers.length === 0) return;
    this.markers.push(...markers);
    this.justAdded = null;
    this.render();
  }

  /** Current marker count (for tests / debugging). */
  count(): number {
    return this.markers.length;
  }

  /** Re-paint all markers against the current viewport. */
  render(viewport?: { width: number; height: number }): void {
    const vp = viewport ?? this.viewport();
    this.container.replaceChildren();

    const inputs: MarkerInput[] = this.markers.map((m) => ({
      number: m.number,
      rect: m.rect,
    }));

    const { visible, offscreen } = partitionByViewport(inputs, vp);

    // U12: numbers rendered in the distinct stale state (kept visible).
    const staleNumbers = new Set<number>(
      this.markers.filter((m) => m.isStale).map((m) => m.number),
    );

    for (const cluster of clusterMarkers(visible, this.thresholdPx)) {
      const el = this.doc.createElement("div");
      if (cluster.isCluster) {
        el.className = "sc-marker sc-cluster";
      } else if (staleNumbers.has(cluster.numbers[0]!)) {
        el.className = "sc-marker sc-stale";
      } else {
        el.className = "sc-marker";
      }
      el.style.left = `${cluster.point.x}px`;
      el.style.top = `${cluster.point.y}px`;
      el.textContent = cluster.isCluster
        ? String(cluster.numbers.length)
        : String(cluster.numbers[0]);
      el.setAttribute(
        "data-numbers",
        cluster.numbers.join(","),
      );
      this.container.appendChild(el);
      if (this.justAdded !== null && cluster.numbers.includes(this.justAdded)) {
        popIn(el);
      }
    }

    for (const off of offscreen) {
      const el = this.doc.createElement("div");
      el.className = staleNumbers.has(off.number) ? "sc-edge sc-stale" : "sc-edge";
      el.setAttribute("data-direction", edgeDirection(off.point, vp));
      el.setAttribute("data-number", String(off.number));
      // Pin the indicator to the nearest viewport edge along the direction.
      const clampedX = Math.max(8, Math.min(vp.width - 30, off.point.x));
      const clampedY = Math.max(8, Math.min(vp.height - 30, off.point.y));
      el.style.left = `${clampedX}px`;
      el.style.top = `${clampedY}px`;
      el.textContent = String(off.number);
      this.container.appendChild(el);
    }
  }

  /** Number of currently-rendered pins/badges (clusters count once). */
  renderedPinCount(): number {
    return this.container.querySelectorAll(".sc-marker").length;
  }

  /** Number of currently-rendered off-screen edge indicators. */
  renderedEdgeCount(): number {
    return this.container.querySelectorAll(".sc-edge").length;
  }

  private viewport(): { width: number; height: number } {
    const w =
      (this.doc.defaultView && this.doc.defaultView.innerWidth) ||
      this.doc.documentElement.clientWidth ||
      1024;
    const h =
      (this.doc.defaultView && this.doc.defaultView.innerHeight) ||
      this.doc.documentElement.clientHeight ||
      768;
    return { width: w, height: h };
  }
}
