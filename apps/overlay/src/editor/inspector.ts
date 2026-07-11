/**
 * The in-page element inspector (requirement D; persistent chrome — U4).
 *
 * A non-interactive overlay drawn at an element's viewport rect that tells the
 * reviewer WHAT they're looking at — even in passive Browse mode, not just Edit:
 * a magenta tag badge (`<h2>`, `<div>`), the class + pixel dimensions, and violet
 * spacing pills for each non-zero margin. It mirrors the reference's on-canvas
 * inspector and complements the properties panel (which edits the element).
 *
 * U4 makes the chrome PERSISTENT: the box, tag, dims, and a pooled set of pills
 * are created once and REPOSITIONED via style updates on every re-render, never
 * rebuilt with `replaceChildren`. Re-renders fire after every history apply/invert
 * (so the box + size badge track an edit's geometry immediately, R4), are
 * rAF-batched during gestures, and still run on the existing scroll/resize hooks.
 * With a selection active, hovering another element draws distance pills between
 * their nearest edges (R11). A hidden element (U6's Hide) shows a collapsed ghost
 * at its vacated slot.
 *
 * Rendered into the shadow layer in FIXED/viewport coordinates like the selection
 * highlight, so it never intercepts host clicks (pointer-events: none) and needs
 * no document-coordinate math. The margin read uses `getComputedStyle` (real-env
 * only; absent it simply draws no pills). Never throws.
 */
import { readComputedValue } from "./style-edits.js";
import { toRect } from "../core/rect.js";

/** A viewport-space rectangle (CSS px), straight from getBoundingClientRect. */
interface ViewRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Margins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** A positioned margin pill (viewport coords, at the middle of its margin band). */
export interface MarginPill {
  side: "top" | "right" | "bottom" | "left";
  value: number;
  x: number;
  y: number;
}

/** A positioned distance pill between the selection and a hovered element (R11). */
export interface DistancePill {
  axis: "x" | "y";
  value: number;
  x: number;
  y: number;
}

/** `<h2>` / `<div>` — the tag in angle brackets, lowercased. Never throws. */
export function tagLabel(el: Element): string {
  const tag = (el.tagName || "node").toLowerCase();
  return `<${tag}>`;
}

/** First class token, or "" — the human-facing identity shown next to the dims. */
export function firstClass(el: Element): string {
  try {
    const raw =
      el.getAttribute?.("class") || (el as { className?: string }).className || "";
    return raw.trim().split(/\s+/).filter(Boolean)[0] ?? "";
  } catch {
    return "";
  }
}

/** e.g. ".hero · 1228 × 44" or just "1228 × 44" — class (when present) + dims. */
export function dimsLabel(el: Element, rect: ViewRect): string {
  const dims = `${Math.round(rect.width)} × ${Math.round(rect.height)}`;
  const cls = firstClass(el);
  return cls ? `.${cls} · ${dims}` : dims;
}

/** Parse a computed margin like "48px" to a non-negative integer (0 on failure). */
export function parseMarginPx(value: string | null): number {
  const n = parseFloat(value ?? "");
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

/**
 * Place a pill in the MIDDLE of each non-zero margin band (matching the
 * reference's 220 / 196 / 48 pills). Pure + viewport-space, so it is unit-tested
 * without a browser.
 */
export function computeMarginPills(rect: ViewRect, m: Margins): MarginPill[] {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const pills: MarginPill[] = [];
  if (m.top > 0) pills.push({ side: "top", value: m.top, x: cx, y: rect.y - m.top / 2 });
  if (m.bottom > 0)
    pills.push({ side: "bottom", value: m.bottom, x: cx, y: rect.y + rect.height + m.bottom / 2 });
  if (m.left > 0) pills.push({ side: "left", value: m.left, x: rect.x - m.left / 2, y: cy });
  if (m.right > 0)
    pills.push({ side: "right", value: m.right, x: rect.x + rect.width + m.right / 2, y: cy });
  return pills;
}

/**
 * Distance pills between a selection rect `a` and a hovered rect `b` (R11): the
 * horizontal gap between nearest vertical edges and the vertical gap between
 * nearest horizontal edges (only when there IS a gap on that axis). Pure +
 * viewport-space so it is unit-tested without a browser.
 */
export function computeDistancePills(a: ViewRect, b: ViewRect): DistancePill[] {
  const aR = a.x + a.width;
  const aB = a.y + a.height;
  const bR = b.x + b.width;
  const bB = b.y + b.height;
  const bandY = (Math.max(a.y, b.y) + Math.min(aB, bB)) / 2;
  const bandX = (Math.max(a.x, b.x) + Math.min(aR, bR)) / 2;
  const pills: DistancePill[] = [];
  if (b.x > aR) pills.push({ axis: "x", value: Math.round(b.x - aR), x: (aR + b.x) / 2, y: bandY });
  else if (bR < a.x) pills.push({ axis: "x", value: Math.round(a.x - bR), x: (bR + a.x) / 2, y: bandY });
  if (b.y > aB) pills.push({ axis: "y", value: Math.round(b.y - aB), x: bandX, y: (aB + b.y) / 2 });
  else if (bB < a.y) pills.push({ axis: "y", value: Math.round(a.y - bB), x: bandX, y: (bB + a.y) / 2 });
  return pills;
}

export class InspectorLayer {
  private readonly container: HTMLElement;
  private current: Element | null = null;
  private attached = false;
  private rafPending = false;

  // Persistent chrome nodes (created once, repositioned each render — U4).
  private readonly box: HTMLElement;
  private readonly badge: HTMLElement;
  private readonly dims: HTMLElement;
  private readonly ghost: HTMLElement;
  private readonly marginPool: HTMLElement[] = [];
  private readonly distancePool: HTMLElement[] = [];

  /** The element being measured-to on hover, and the ghost's rect (U6). */
  private hovered: Element | null = null;
  private ghostRect: ViewRect | null = null;

  constructor(
    private readonly doc: Document,
    parent: HTMLElement,
  ) {
    this.container = doc.createElement("div");
    this.container.className = "sc-inspect-container";
    parent.appendChild(this.container);
    this.box = this.node("div", "sc-inspect-box");
    this.badge = this.node("div", "sc-inspect-tag");
    this.dims = this.node("div", "sc-inspect-dims");
    this.ghost = this.node("div", "sc-inspect-ghost");
    this.hideNode(this.ghost);
  }

  /** Whether the inspector is currently showing an element. */
  isActive(): boolean {
    return this.current !== null;
  }

  /** Show the inspector for `el` (re-measures + repaints). */
  show(el: Element): void {
    this.current = el;
    this.clearHover();
    this.attach();
    this.render();
  }

  /** Hide the inspector (nothing hovered / selected). */
  hide(): void {
    this.current = null;
    this.clearHover();
    this.detach();
  }

  /**
   * Measure the distance from the current selection to a hovered element (R11).
   * No-op when there is no selection or the hovered element IS the selection.
   */
  measureTo(el: Element | null): void {
    if (!this.current || el === this.current) {
      this.clearHover();
      return;
    }
    this.hovered = el;
    this.render();
  }

  /** Stop drawing hover distance pills. */
  clearHover(): void {
    if (!this.hovered) return;
    this.hovered = null;
    this.render();
  }

  /**
   * Show a collapsed ghost affordance at a hidden element's vacated slot (U6's
   * Hide interplay). Pass null to clear it.
   */
  setGhost(rect: ViewRect | null): void {
    this.ghostRect = rect;
    this.render();
  }

  /** Re-render on the next animation frame (coalesces a burst during gestures). */
  scheduleRender(): void {
    if (this.rafPending) return;
    const raf = (this.doc.defaultView as { requestAnimationFrame?: (cb: () => void) => void } | null)
      ?.requestAnimationFrame;
    if (typeof raf !== "function") {
      this.render();
      return;
    }
    this.rafPending = true;
    raf(() => {
      this.rafPending = false;
      this.render();
    });
  }

  /** Re-measure + reposition every persistent node (scroll / resize / edit). */
  render(): void {
    const el = this.current;
    if (!el || !this.attached) return;
    const rect = readRect(el);
    if (!rect) {
      this.hideNode(this.box);
      this.hideNode(this.badge);
      this.hideNode(this.dims);
    } else {
      this.place(this.box, rect.x, rect.y);
      this.box.style.width = `${rect.width}px`;
      this.box.style.height = `${rect.height}px`;
      this.showNode(this.box);

      this.badge.textContent = tagLabel(el);
      this.place(this.badge, rect.x, rect.y);
      this.showNode(this.badge);

      this.dims.textContent = dimsLabel(el, rect);
      this.place(this.dims, rect.x + rect.width / 2, rect.y + rect.height);
      this.showNode(this.dims);
    }

    // Spacing pills (real-env; empty without getComputedStyle).
    const marginPills = rect ? computeMarginPills(rect, readMargins(el)) : [];
    this.syncPool(this.marginPool, "sc-inspect-pill", marginPills.length, (node, i) => {
      const pill = marginPills[i]!;
      node.textContent = String(pill.value);
      this.place(node, pill.x, pill.y);
    });

    // Hover distance pills between the selection and the hovered element (R11).
    const hoverRect = this.hovered ? readRect(this.hovered) : null;
    const distancePills = rect && hoverRect ? computeDistancePills(rect, hoverRect) : [];
    this.syncPool(this.distancePool, "sc-inspect-measure", distancePills.length, (node, i) => {
      const pill = distancePills[i]!;
      node.textContent = String(pill.value);
      node.setAttribute("data-axis", pill.axis);
      this.place(node, pill.x, pill.y);
    });

    // Hidden-element ghost (U6).
    if (this.ghostRect) {
      this.place(this.ghost, this.ghostRect.x, this.ghostRect.y);
      this.ghost.style.width = `${this.ghostRect.width}px`;
      this.ghost.style.height = `${this.ghostRect.height}px`;
      this.showNode(this.ghost);
    } else {
      this.hideNode(this.ghost);
    }
  }

  private attach(): void {
    if (this.attached) return;
    this.container.append(this.badge, this.box, this.dims, this.ghost);
    this.attached = true;
  }

  private detach(): void {
    this.container.replaceChildren();
    // Pool nodes were removed with replaceChildren; drop the stale references so
    // the next show rebuilds them (node identity only needs to be stable across
    // re-renders WHILE shown, not across a hide/show).
    this.marginPool.length = 0;
    this.distancePool.length = 0;
    this.attached = false;
  }

  /** Grow/shrink a pooled node set to `count`, positioning the live ones. */
  private syncPool(
    pool: HTMLElement[],
    className: string,
    count: number,
    place: (node: HTMLElement, i: number) => void,
  ): void {
    while (pool.length < count) {
      const node = this.node("div", className);
      pool.push(node);
      this.container.appendChild(node);
    }
    for (let i = 0; i < pool.length; i++) {
      const node = pool[i]!;
      if (i < count) {
        place(node, i);
        this.showNode(node);
      } else {
        this.hideNode(node);
      }
    }
  }

  private place(node: HTMLElement, x: number, y: number): void {
    node.style.left = `${x}px`;
    node.style.top = `${y}px`;
  }

  private showNode(node: HTMLElement): void {
    node.style.display = "";
  }

  private hideNode(node: HTMLElement): void {
    node.style.display = "none";
  }

  private node(tag: string, className: string): HTMLElement {
    const el = this.doc.createElement(tag);
    el.className = className;
    return el;
  }
}

/** The element's viewport rect, or null when it can't be measured. Never throws. */
function readRect(el: Element): ViewRect | null {
  try {
    const r = el.getBoundingClientRect();
    if (!r) return null;
    return toRect(r);
  } catch {
    return null;
  }
}

/** Read the four computed margins (real-env; all 0 without getComputedStyle). */
function readMargins(el: Element): Margins {
  return {
    top: parseMarginPx(readComputedValue(el, "margin-top")),
    right: parseMarginPx(readComputedValue(el, "margin-right")),
    bottom: parseMarginPx(readComputedValue(el, "margin-bottom")),
    left: parseMarginPx(readComputedValue(el, "margin-left")),
  };
}
