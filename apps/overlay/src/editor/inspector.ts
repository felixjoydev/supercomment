/**
 * The in-page element inspector (requirement D).
 *
 * A non-interactive overlay drawn at an element's viewport rect that tells the
 * reviewer WHAT they're looking at — even in passive Browse mode, not just Edit:
 * a magenta tag badge (`<h2>`, `<div>`), the class + pixel dimensions, and violet
 * spacing pills for each non-zero margin. It mirrors the reference's on-canvas
 * inspector and complements the properties panel (which edits the element).
 *
 * Rendered into the shadow layer in FIXED/viewport coordinates like the selection
 * highlight, so it never intercepts host clicks (pointer-events: none) and needs
 * no document-coordinate math. The margin read uses `getComputedStyle` (real-env
 * only; absent it simply draws no pills). Never throws.
 */
import { readComputedValue } from "./style-edits.js";

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

export class InspectorLayer {
  private readonly container: HTMLElement;
  private current: Element | null = null;

  constructor(
    private readonly doc: Document,
    parent: HTMLElement,
  ) {
    this.container = doc.createElement("div");
    this.container.className = "sc-inspect-container";
    parent.appendChild(this.container);
  }

  /** Whether the inspector is currently showing an element. */
  isActive(): boolean {
    return this.current !== null;
  }

  /** Show the inspector for `el` (re-measures + repaints). */
  show(el: Element): void {
    this.current = el;
    this.render();
  }

  /** Hide the inspector (nothing hovered / selected). */
  hide(): void {
    this.current = null;
    this.container.replaceChildren();
  }

  /** Re-measure + repaint the current element (scroll / resize). */
  render(): void {
    this.container.replaceChildren();
    const el = this.current;
    if (!el) return;
    const rect = readRect(el);
    if (!rect) return;

    // Selection box.
    const box = this.node("div", "sc-inspect-box");
    box.style.left = `${rect.x}px`;
    box.style.top = `${rect.y}px`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;
    this.container.appendChild(box);

    // Tag badge, pinned to the top-left corner (sits just above the box via CSS).
    const badge = this.node("div", "sc-inspect-tag");
    badge.textContent = tagLabel(el);
    badge.style.left = `${rect.x}px`;
    badge.style.top = `${rect.y}px`;
    this.container.appendChild(badge);

    // Class + dimensions, centered under the box.
    const dims = this.node("div", "sc-inspect-dims");
    dims.textContent = dimsLabel(el, rect);
    dims.style.left = `${rect.x + rect.width / 2}px`;
    dims.style.top = `${rect.y + rect.height}px`;
    this.container.appendChild(dims);

    // Spacing pills for each non-zero margin (real-env; empty without getComputedStyle).
    for (const pill of computeMarginPills(rect, readMargins(el))) {
      const p = this.node("div", "sc-inspect-pill");
      p.textContent = String(pill.value);
      p.style.left = `${pill.x}px`;
      p.style.top = `${pill.y}px`;
      this.container.appendChild(p);
    }
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
    return { x: r.x ?? r.left, y: r.y ?? r.top, width: r.width, height: r.height };
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
