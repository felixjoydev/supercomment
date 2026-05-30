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

/** A placed comment marker, anchored to its target rect (viewport space). */
export interface PlacedMarker {
  number: number;
  rect: Rect;
}

export class MarkerLayer {
  private readonly container: HTMLElement;
  private readonly markers: PlacedMarker[] = [];

  constructor(
    private readonly doc: Document,
    parent: HTMLElement,
    private readonly thresholdPx: number = DEFAULT_CLUSTER_THRESHOLD_PX,
  ) {
    this.container = doc.createElement("div");
    this.container.className = "sc-marker-container";
    parent.appendChild(this.container);
  }

  /** Register a new marker and repaint. */
  add(marker: PlacedMarker): void {
    this.markers.push(marker);
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

    for (const cluster of clusterMarkers(visible, this.thresholdPx)) {
      const el = this.doc.createElement("div");
      el.className = cluster.isCluster ? "sc-marker sc-cluster" : "sc-marker";
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
    }

    for (const off of offscreen) {
      const el = this.doc.createElement("div");
      el.className = "sc-edge";
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
