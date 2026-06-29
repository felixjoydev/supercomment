/**
 * Marker rendering into the shadow layer.
 *
 * Takes the placed markers, clusters the visible ones into pins/badges and
 * draws edge indicators for off-screen ones, then paints them into a dedicated
 * container. Pure clustering math lives in `cluster.ts`; this file only renders
 * the results, so it stays thin.
 *
 * Pins are clickable (R12): clicking one opens a popover card with the comment
 * content so a reviewer can READ the thread on the live deploy, not just see
 * numbered pins.
 */
import type { MarkerComment, Rect } from "../core/types.js";
import {
  clusterMarkers,
  partitionByViewport,
  DEFAULT_CLUSTER_THRESHOLD_PX,
  type MarkerInput,
} from "./cluster.js";
import { edgeDirection } from "../core/geometry.js";
import { popIn } from "../shell/motion.js";

/** Comment-popover sizing (CSS px). Mirrors `.sc-comment-pop` in styles.ts. */
const POPOVER_WIDTH = 280;
const POPOVER_MARGIN = 12;
/** Rough height used for edge-aware placement before the card is measured. */
const POPOVER_EST_HEIGHT = 132;

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
  /**
   * U12: the human-readable comment shown in the popover when this pin is
   * clicked. Optional so non-read callers (and older tests) can place a bare
   * numbered pin; when absent the popover shows just the number.
   */
  content?: MarkerComment;
}

export class MarkerLayer {
  private readonly container: HTMLElement;
  private readonly markers: PlacedMarker[] = [];
  /** Number of the marker added by the latest add(), so only IT pops in —
   * scroll/resize repaints must not replay entrance animations. */
  private justAdded: number | null = null;

  /** The open comment popover (lives on `parent`, NOT `container`, so the
   * scroll/resize repaint's `replaceChildren()` cannot destroy it). */
  private popover: HTMLElement | null = null;
  /** The comment numbers the open popover represents (the clicked cluster). */
  private popoverNumbers: number[] | null = null;

  constructor(
    private readonly doc: Document,
    private readonly parent: HTMLElement,
    private readonly thresholdPx: number = DEFAULT_CLUSTER_THRESHOLD_PX,
  ) {
    this.container = doc.createElement("div");
    this.container.className = "sc-marker-container";
    this.parent.appendChild(this.container);

    // ONE delegated click listener: pins are re-created on every repaint
    // (`container.replaceChildren()`), so a per-pin listener would be lost each
    // paint. The container survives, and clicks on its pins bubble up to it.
    this.container.addEventListener("click", (e) => this.handlePinClick(e));
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

    const clusters = clusterMarkers(visible, this.thresholdPx);
    for (const cluster of clusters) {
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

    // Keep an open popover anchored to its cluster across scroll/resize. If the
    // pin re-clustered or scrolled off-screen there is no matching visible
    // cluster, so close the popover rather than leave it floating.
    if (this.popover && this.popoverNumbers) {
      const match = clusters.find((c) =>
        sameNumberSet(c.numbers, this.popoverNumbers!),
      );
      if (match) this.positionPopover(match.point);
      else this.closePopover();
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

  /** True when a comment popover is currently open (for tests / debugging). */
  hasOpenPopover(): boolean {
    return this.popover !== null;
  }

  // --- Comment popover ----------------------------------------------------

  /** Toggle the popover for whichever pin/cluster was clicked. */
  private handlePinClick(e: Event): void {
    const target = e.target as Element | null;
    const pin = target?.closest?.(".sc-marker") as HTMLElement | null;
    if (!pin) return;
    const numbers = parseNumbers(pin.getAttribute("data-numbers"));
    if (numbers.length === 0) return;

    // Clicking the already-open pin closes it; a different pin switches content.
    if (this.popover && sameNumberSet(numbers, this.popoverNumbers ?? [])) {
      this.closePopover();
      return;
    }
    this.showPopover(numbers, {
      x: parseFloat(pin.style.left) || 0,
      y: parseFloat(pin.style.top) || 0,
    });
  }

  /**
   * Open a popover card listing every marker whose number is in `numbers`
   * (cluster → multiple entries). Appended to the PARENT layer so a scroll
   * repaint's `container.replaceChildren()` cannot destroy it.
   */
  showPopover(numbers: number[], anchorPoint: { x: number; y: number }): void {
    this.closePopover();

    const pop = this.doc.createElement("div");
    pop.className = "sc-comment-pop";
    pop.setAttribute("role", "dialog");
    pop.setAttribute("aria-label", "Comment");

    const close = this.doc.createElement("button");
    close.type = "button";
    close.className = "sc-comment-pop-close";
    close.setAttribute("aria-label", "Close");
    close.textContent = "×"; // ×
    close.addEventListener("click", () => this.closePopover());
    pop.appendChild(close);

    const wanted = new Set(numbers);
    for (const m of this.markers.filter((mk) => wanted.has(mk.number))) {
      pop.appendChild(this.buildEntry(m));
    }

    this.parent.appendChild(pop);
    this.popover = pop;
    this.popoverNumbers = numbers.slice();
    this.positionPopover(anchorPoint);
  }

  /** Public close — remove the popover element and clear refs. */
  closePopover(): void {
    this.popover?.remove();
    this.popover = null;
    this.popoverNumbers = null;
  }

  /** Build one comment entry: `#N · Author`, meta, note, and a short time. */
  private buildEntry(m: PlacedMarker): HTMLElement {
    const entry = this.doc.createElement("div");
    entry.className = "sc-comment-entry";

    const head = this.doc.createElement("div");
    head.className = "sc-comment-head";
    const num = this.doc.createElement("span");
    num.className = "sc-comment-num";
    num.textContent = `#${m.number}`;
    head.appendChild(num);
    const author = m.content?.authorDisplayName;
    if (author) {
      const who = this.doc.createElement("span");
      who.className = "sc-comment-author";
      who.textContent = ` · ${author}`; // ·
      head.appendChild(who);
    }
    entry.appendChild(head);

    const metaParts = [
      m.content?.intent,
      m.content?.severity,
      m.content?.status,
    ].filter((v): v is string => !!v);
    if (metaParts.length > 0) {
      const meta = this.doc.createElement("div");
      meta.className = "sc-comment-meta";
      meta.textContent = metaParts.join(" · "); // ·
      entry.appendChild(meta);
    }

    const noteText = m.content?.note ?? "";
    if (noteText) {
      const note = this.doc.createElement("div");
      note.className = "sc-comment-note";
      note.textContent = noteText;
      entry.appendChild(note);
    }

    const when = shortTime(m.content?.createdAt);
    if (when) {
      const time = this.doc.createElement("div");
      time.className = "sc-comment-time";
      time.textContent = when;
      entry.appendChild(time);
    }

    return entry;
  }

  /** Place the popover near `anchor` (a pin center), clamped to the viewport. */
  private positionPopover(anchor: { x: number; y: number }): void {
    if (!this.popover) return;
    const vp = this.viewport();

    // Prefer just below-right of the pin; flip left/up when it would overflow.
    let left = anchor.x + 16;
    if (left + POPOVER_WIDTH + POPOVER_MARGIN > vp.width) {
      left = anchor.x - POPOVER_WIDTH - 16;
    }
    left = Math.max(
      POPOVER_MARGIN,
      Math.min(left, vp.width - POPOVER_WIDTH - POPOVER_MARGIN),
    );

    let top = anchor.y + 16;
    if (top + POPOVER_EST_HEIGHT + POPOVER_MARGIN > vp.height) {
      top = anchor.y - POPOVER_EST_HEIGHT - 16;
    }
    top = Math.max(POPOVER_MARGIN, top);

    this.popover.style.left = `${left}px`;
    this.popover.style.top = `${top}px`;
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

/** Parse a `data-numbers` comma list ("1,2,3") into numbers. */
function parseNumbers(raw: string | null): number[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n));
}

/** True when two number lists hold the same set (order-independent). */
function sameNumberSet(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(b);
  return a.every((n) => set.has(n));
}

/** Compact relative time ("just now", "5m ago", …) for a comment's createdAt. */
function shortTime(iso?: string): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const sec = Math.round((Date.now() - t) / 1000);
  if (sec < 45) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(t).toLocaleDateString();
}
