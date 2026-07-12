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
import {
  readComputedValue,
  readInlineSnapshot,
  restoreInlineSnapshot,
  applyStylePreview,
  type InlineSnapshot,
} from "./style-edits.js";
import { toRect } from "../core/rect.js";
import { Gesture, type Point } from "./interact/gesture.js";
import {
  computeResize,
  resizeApplicable,
  HANDLES,
  type Handle,
  type ResizeStart,
  type BoxMetrics,
  type ResizeResult,
  type ResizeModifiers,
} from "./interact/resize.js";
import {
  inFlowCandidates,
  resolveSlot,
  type RawSibling,
  type Candidate,
  type Slot,
} from "./interact/reorder.js";
import { layoutContextFor } from "./layout-context.js";

/** A committed drag-reorder handed to the controller to record as a moveNode. */
export interface ReorderCommit {
  /** The dragged element's current DOM index (order.from). */
  from: number;
  /** The slot's true DOM insert index (order.to). */
  to: number;
  /** The reference sibling's DOM index the drop anchors to. */
  referenceIndex: number;
  position: "before" | "after";
}

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

/**
 * A collapsed-slot placeholder for a HIDDEN element (U6 + hidden-recovery). When
 * `onRestore` is set the placeholder is an interactive "Show" button so the
 * reviewer can un-hide the element without hunting for Cmd+Z.
 */
export interface GhostSpec {
  rect: ViewRect;
  /** The hidden element's tag, for the "Show <tag>" label. */
  tag?: string;
  /** Restore the hidden element (revert its hide edit). */
  onRestore?: () => void;
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
  private readonly marginPool: HTMLElement[] = [];
  private readonly distancePool: HTMLElement[] = [];
  /** Clickable "Show" placeholders for hidden elements (a pool, one per ghost). */
  private readonly ghostPool: HTMLElement[] = [];
  private ghosts: GhostSpec[] = [];

  /** The element being measured-to on hover. */
  private hovered: Element | null = null;

  // U12 — resize handles + the live drag state.
  private readonly handles = new Map<Handle, HTMLElement>();
  private readonly onResizeCommit?: (dims: ResizeResult) => void;
  private readonly readMetrics: (el: Element) => BoxMetrics;
  private resizable = false;
  private lastDims: ResizeResult | null = null;
  private resize: {
    el: Element;
    handle: Handle;
    start: ResizeStart;
    inlineW: InlineSnapshot;
    inlineH: InlineSnapshot;
    mods: ResizeModifiers;
    gesture: Gesture;
  } | null = null;

  // U13 — drag-to-reorder: a grip on the box, an insertion line, the drag state.
  private readonly reorderGrip: HTMLElement;
  private readonly insertionLine: HTMLElement;
  private readonly onReorderCommit?: (c: ReorderCommit) => void;
  private reorder: {
    el: Element;
    parent: Element;
    from: number;
    candidates: Candidate[];
    axis: ReturnType<typeof layoutContextFor>["axis"];
    container: ViewRect;
    inlineOpacity: InlineSnapshot;
    slot: Slot | null;
    gesture: Gesture;
  } | null = null;

  constructor(
    private readonly doc: Document,
    parent: HTMLElement,
    opts: {
      /** Record the committed size (one gesture step); the controller wires it. */
      onResizeCommit?: (dims: ResizeResult) => void;
      /** Record a committed drag-reorder as a moveNode; the controller wires it. */
      onReorderCommit?: (c: ReorderCommit) => void;
      /** Read box metrics for handle applicability + scale (default: live DOM). */
      readMetrics?: (el: Element) => BoxMetrics;
    } = {},
  ) {
    this.container = doc.createElement("div");
    this.container.className = "sc-inspect-container";
    parent.appendChild(this.container);
    this.box = this.node("div", "sc-inspect-box");
    this.badge = this.node("div", "sc-inspect-tag");
    this.dims = this.node("div", "sc-inspect-dims");
    this.onResizeCommit = opts.onResizeCommit;
    this.onReorderCommit = opts.onReorderCommit;
    this.readMetrics = opts.readMetrics ?? ((el) => liveMetrics(el));
    for (const h of HANDLES) {
      const node = this.node("div", `sc-inspect-handle sc-inspect-handle-${h}`);
      node.setAttribute("data-handle", h);
      this.wireHandle(h, node);
      this.handles.set(h, node);
    }
    this.reorderGrip = this.node("div", "sc-inspect-reorder-grip");
    this.reorderGrip.setAttribute("aria-label", "Drag to reorder");
    this.reorderGrip.textContent = "⠿";
    this.reorderGrip.addEventListener("pointerdown", (e) => this.beginReorder(e as PointerEvent));
    this.insertionLine = this.node("div", "sc-inspect-insertion");
    this.hideNode(this.insertionLine);
    this.wireDragListeners();
  }

  /** Whether the inspector is currently showing an element. */
  isActive(): boolean {
    return this.current !== null;
  }

  /**
   * Show the inspector for `el` (re-measures + repaints). `resizable` renders the
   * interactive 8-point resize handles — only in Edit mode (a panel is open to
   * record into), never in passive Browse (the chrome stays pointer-transparent).
   */
  show(el: Element, opts: { resizable?: boolean } = {}): void {
    this.current = el;
    this.resizable = opts.resizable === true;
    this.clearHover();
    this.attach();
    this.render();
  }

  /** Hide the inspector (nothing hovered / selected). */
  hide(): void {
    this.abortDrag();
    this.current = null;
    this.resizable = false;
    this.hovered = null;
    // Keep the layer alive while hidden elements still need their "Show"
    // placeholders (the box/badge just stop drawing); only fully detach when
    // there is nothing left to show.
    if (this.ghosts.length > 0) this.render();
    else this.detach();
  }

  /** Is a resize OR reorder drag currently live? (drives the gesture Escape layer). */
  isDragging(): boolean {
    return this.resize != null || this.reorder != null;
  }

  /** Cancel any live drag (resize / reorder), restoring cleanly (no record). */
  abortDrag(): void {
    this.resize?.gesture.cancel();
    this.reorder?.gesture.cancel();
  }

  /** Is a resize drag currently live? (test seam / narrower predicate). */
  isResizing(): boolean {
    return this.resize != null;
  }

  /** Cancel a live resize drag, restoring the pre-gesture size (no record). */
  abortResize(): void {
    this.resize?.gesture.cancel();
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
   * Hide interplay). Pass null to clear it. Back-compat shim over {@link setGhosts}.
   */
  setGhost(rect: ViewRect | null): void {
    this.setGhosts(rect ? [{ rect }] : []);
  }

  /**
   * Render the set of hidden-element placeholders (one clickable "Show" pill per
   * hidden element). Attaches the inspector when there are ghosts so they survive
   * even with no element selected; passing `[]` clears them.
   */
  setGhosts(specs: GhostSpec[]): void {
    this.ghosts = specs;
    if (specs.length > 0) this.attach();
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
    if (!this.attached) return;
    const el = this.current;
    const rect = el ? readRect(el) : null;
    // A HIDDEN element (display:none) reports a zero-area rect at (0,0) — drawing
    // the box/badge/handles there is the "stuck at top-left" bug. Treat it (and a
    // missing rect / no selection) as unmeasurable: hide the selection chrome and
    // let the hidden-element ghost be the only affordance.
    const hasBox = !!el && !!rect && !isZeroArea(rect);
    if (!hasBox) {
      this.hideNode(this.box);
      this.hideNode(this.badge);
      this.hideNode(this.dims);
      this.hideHandles();
      this.hideNode(this.reorderGrip);
    } else {
      this.place(this.box, rect.x, rect.y);
      this.box.style.width = `${rect.width}px`;
      this.box.style.height = `${rect.height}px`;
      this.showNode(this.box);

      this.badge.textContent = tagLabel(el);
      this.place(this.badge, rect.x, rect.y);
      this.showNode(this.badge);

      // While resizing, the dims badge shows the LIVE target size (R4).
      this.dims.textContent =
        this.resize && this.lastDims
          ? `${this.lastDims.width} × ${this.lastDims.height}`
          : dimsLabel(el, rect);
      this.place(this.dims, rect.x + rect.width / 2, rect.y + rect.height);
      this.showNode(this.dims);

      this.renderHandles(el, rect);
      this.renderReorderGrip(el, rect);
    }

    // The insertion line follows the live reorder slot (drawn in viewport coords).
    if (this.reorder?.slot) {
      const line = this.reorder.slot.line;
      this.place(this.insertionLine, line.x, line.y);
      this.insertionLine.style.width = `${line.width}px`;
      this.insertionLine.style.height = `${line.height}px`;
      this.showNode(this.insertionLine);
    } else {
      this.hideNode(this.insertionLine);
    }

    // Spacing pills (real-env; empty without getComputedStyle).
    const marginPills = hasBox ? computeMarginPills(rect, readMargins(el)) : [];
    this.syncPool(this.marginPool, "sc-inspect-pill", marginPills.length, (node, i) => {
      const pill = marginPills[i]!;
      node.textContent = String(pill.value);
      this.place(node, pill.x, pill.y);
    });

    // Hover distance pills between the selection and the hovered element (R11).
    const hoverRect = this.hovered ? readRect(this.hovered) : null;
    const distancePills = hasBox && hoverRect ? computeDistancePills(rect, hoverRect) : [];
    this.syncPool(this.distancePool, "sc-inspect-measure", distancePills.length, (node, i) => {
      const pill = distancePills[i]!;
      node.textContent = String(pill.value);
      node.setAttribute("data-axis", pill.axis);
      this.place(node, pill.x, pill.y);
    });

    this.renderGhosts();
  }

  /** Draw the clickable "Show" placeholders for the current hidden-element set. */
  private renderGhosts(): void {
    const specs = this.ghosts;
    while (this.ghostPool.length < specs.length) {
      const node = this.node("button", "sc-inspect-ghost") as HTMLButtonElement;
      node.type = "button";
      node.addEventListener("click", () => {
        const spec = (node as unknown as { __spec?: GhostSpec }).__spec;
        spec?.onRestore?.();
      });
      this.ghostPool.push(node);
      this.container.appendChild(node);
    }
    for (let i = 0; i < this.ghostPool.length; i++) {
      const node = this.ghostPool[i]!;
      const spec = specs[i];
      (node as unknown as { __spec?: GhostSpec }).__spec = spec;
      if (spec) {
        this.place(node, spec.rect.x, spec.rect.y);
        node.style.width = `${spec.rect.width}px`;
        node.style.height = `${spec.rect.height}px`;
        node.textContent = spec.onRestore ? `Show ${spec.tag ?? "element"}` : "";
        node.setAttribute(
          "aria-label",
          spec.onRestore ? `Show hidden ${spec.tag ?? "element"}` : "hidden element",
        );
        node.setAttribute("data-interactive", spec.onRestore ? "1" : "0");
        this.showNode(node);
      } else {
        this.hideNode(node);
      }
    }
  }

  private attach(): void {
    if (this.attached) return;
    this.container.append(
      this.badge,
      this.box,
      this.dims,
      this.insertionLine,
      this.reorderGrip,
      ...this.handles.values(),
    );
    this.attached = true;
  }

  private detach(): void {
    this.container.replaceChildren();
    // Pool nodes were removed with replaceChildren; drop the stale references so
    // the next show rebuilds them (node identity only needs to be stable across
    // re-renders WHILE shown, not across a hide/show).
    this.marginPool.length = 0;
    this.distancePool.length = 0;
    this.ghostPool.length = 0;
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

  // --- Resize handles (U12) -------------------------------------------------

  /** Position the 8 handles on the box; show them only when resize applies. */
  private renderHandles(el: Element, rect: ViewRect): void {
    const applicable =
      this.resizable && (this.resize != null || resizeApplicable(this.readMetrics(el)));
    if (!applicable) {
      this.hideHandles();
      return;
    }
    const pos = handlePositions(rect);
    for (const h of HANDLES) {
      const node = this.handles.get(h)!;
      const [x, y] = pos[h];
      this.place(node, x, y);
      this.showNode(node);
    }
  }

  private hideHandles(): void {
    for (const node of this.handles.values()) this.hideNode(node);
  }

  /** A handle receives the press: arm the resize gesture for it. */
  private wireHandle(handle: Handle, node: HTMLElement): void {
    node.addEventListener("pointerdown", (e) => this.beginResize(handle, e as PointerEvent));
  }

  /** Document-level pointer + abort listeners that drive a live resize. */
  private wireDragListeners(): void {
    const doc = this.doc as unknown as {
      addEventListener?: (t: string, cb: (e: unknown) => void) => void;
    };
    doc.addEventListener?.("pointermove", (e) => {
      const r = this.resize;
      if (r) {
        const ev = e as { shiftKey?: boolean; altKey?: boolean };
        r.mods = { aspect: !!ev.shiftKey, center: !!ev.altKey };
        r.gesture.move(pointOf(e));
      }
      this.reorder?.gesture.move(pointOf(e));
    });
    doc.addEventListener?.("pointerup", (e) => {
      this.resize?.gesture.up(pointOf(e));
      this.reorder?.gesture.up(pointOf(e));
    });
    doc.addEventListener?.("pointercancel", () => {
      this.resize?.gesture.cancel();
      this.reorder?.gesture.cancel();
    });
    const view = this.doc.defaultView as { addEventListener?: (t: string, cb: () => void) => void } | null;
    view?.addEventListener?.("blur", () => this.abortDrag());
  }

  private beginResize(handle: Handle, e: PointerEvent): void {
    const el = this.current;
    if (!el || this.resize || !this.resizable) return;
    const rect = readRect(el);
    const m = this.readMetrics(el);
    if (!rect || !resizeApplicable(m)) return;
    (e as { preventDefault?: () => void }).preventDefault?.();
    (e as { stopPropagation?: () => void }).stopPropagation?.();
    const start: ResizeStart = {
      width: m.offsetWidth,
      height: m.offsetHeight,
      rectWidth: rect.width,
      rectHeight: rect.height,
    };
    const gesture = new Gesture(
      {
        onMove: (_p, delta) => this.onResizeMove(delta),
        onCommit: () => this.finishResize(true),
        onAbort: () => this.finishResize(false),
      },
      { activationDistance: 4 },
    );
    this.resize = {
      el,
      handle,
      start,
      inlineW: readInlineSnapshot(el, "width"),
      inlineH: readInlineSnapshot(el, "height"),
      mods: {},
      gesture,
    };
    (e.target as { setPointerCapture?: (id: number) => void } | null)?.setPointerCapture?.(
      (e as { pointerId?: number }).pointerId ?? 0,
    );
    gesture.down(pointOf(e));
  }

  private onResizeMove(delta: Point): void {
    const r = this.resize;
    if (!r) return;
    const dims = computeResize(r.handle, r.start, delta, r.mods);
    this.lastDims = dims;
    // Ephemeral preview (real-env); the authoritative record happens on commit.
    applyStylePreview(r.el, "width", `${dims.width}px`);
    applyStylePreview(r.el, "height", `${dims.height}px`);
    this.scheduleRender();
  }

  /** End the drag: restore the pre-gesture inline, then (on commit) record once. */
  private finishResize(commit: boolean): void {
    const r = this.resize;
    if (!r) return;
    const dims = this.lastDims;
    // Restore the pre-gesture inline so the record re-applies from the dev build.
    restoreInlineSnapshot(r.el, "width", r.inlineW);
    restoreInlineSnapshot(r.el, "height", r.inlineH);
    this.resize = null;
    this.lastDims = null;
    if (commit && dims) this.onResizeCommit?.(dims);
    this.scheduleRender();
  }

  // --- Drag-to-reorder (U13) ------------------------------------------------

  /** Show the reorder grip only while editing, and only when there's a slot to move to. */
  private renderReorderGrip(el: Element, rect: ViewRect): void {
    if (!this.resizable || (!this.reorder && !this.canReorder(el))) {
      this.hideNode(this.reorderGrip);
      return;
    }
    // Anchored just outside the box's top-left so it never covers content.
    this.place(this.reorderGrip, rect.x, rect.y);
    this.showNode(this.reorderGrip);
  }

  /** True when `el` has at least one in-flow sibling to reorder around. */
  private canReorder(el: Element): boolean {
    const parent = el.parentElement;
    if (!parent) return false;
    const { siblings, from } = this.siblingsOf(el, parent);
    return inFlowCandidates(siblings, from).length >= 1;
  }

  /** Measure `el`'s siblings (true DOM indices + computed flow context). */
  private siblingsOf(el: Element, parent: Element): { siblings: RawSibling[]; from: number } {
    const children = Array.from(parent.children);
    const siblings: RawSibling[] = children.map((child, index) => ({
      index,
      rect: readRect(child),
      position: readComputedValue(child, "position") ?? "static",
      display: readComputedValue(child, "display") ?? "block",
    }));
    return { siblings, from: children.indexOf(el) };
  }

  private beginReorder(e: PointerEvent): void {
    const el = this.current;
    if (!el || this.reorder || this.resize || !this.resizable) return;
    const parent = el.parentElement;
    const container = parent ? readRect(parent) : null;
    if (!parent || !container) return;
    const { siblings, from } = this.siblingsOf(el, parent);
    const candidates = inFlowCandidates(siblings, from);
    if (candidates.length === 0) return;
    (e as { preventDefault?: () => void }).preventDefault?.();
    (e as { stopPropagation?: () => void }).stopPropagation?.();
    const gesture = new Gesture(
      {
        onMove: (p) => this.onReorderMove(p),
        onCommit: () => this.finishReorder(true),
        onAbort: () => this.finishReorder(false),
      },
      { activationDistance: 5 },
    );
    this.reorder = {
      el,
      parent,
      from,
      candidates,
      axis: layoutContextFor(el).axis,
      container,
      inlineOpacity: readInlineSnapshot(el, "opacity"),
      slot: null,
      gesture,
    };
    (e.target as { setPointerCapture?: (id: number) => void } | null)?.setPointerCapture?.(
      (e as { pointerId?: number }).pointerId ?? 0,
    );
    // Lift the dragged element slightly so the drop target reads clearly.
    applyStylePreview(el, "opacity", "0.5");
    gesture.down(pointOf(e));
  }

  private onReorderMove(p: Point): void {
    const r = this.reorder;
    if (!r) return;
    r.slot = resolveSlot(r.candidates, r.axis, p, r.container);
    this.scheduleRender();
  }

  private finishReorder(commit: boolean): void {
    const r = this.reorder;
    if (!r) return;
    const slot = r.slot;
    restoreInlineSnapshot(r.el, "opacity", r.inlineOpacity); // clear the lift
    this.reorder = null;
    if (commit && slot && slot.referenceIndex != null) {
      this.onReorderCommit?.({
        from: r.from,
        to: slot.insertIndex,
        referenceIndex: slot.referenceIndex,
        position: slot.position,
      });
    }
    this.scheduleRender();
  }
}

/** The eight handle positions (viewport coords) for a box rect. */
function handlePositions(rect: ViewRect): Record<Handle, [number, number]> {
  const { x, y, width: w, height: h } = rect;
  return {
    nw: [x, y],
    n: [x + w / 2, y],
    ne: [x + w, y],
    e: [x + w, y + h / 2],
    se: [x + w, y + h],
    s: [x + w / 2, y + h],
    sw: [x, y + h],
    w: [x, y + h / 2],
  };
}

/** Read live box metrics for resize applicability + scale. Never throws. */
function liveMetrics(el: Element): BoxMetrics {
  const e = el as {
    offsetWidth?: number;
    offsetHeight?: number;
    getClientRects?: () => { length: number };
  };
  let clientRectCount = 0;
  try {
    clientRectCount = e.getClientRects?.()?.length ?? 0;
  } catch {
    clientRectCount = 0;
  }
  return {
    offsetWidth: typeof e.offsetWidth === "number" ? e.offsetWidth : 0,
    offsetHeight: typeof e.offsetHeight === "number" ? e.offsetHeight : 0,
    clientRectCount,
    display: readComputedValue(el, "display") ?? "block",
  };
}

/** A pointer event → the gesture's Point (viewport coords). */
function pointOf(e: unknown): Point {
  const ev = e as { clientX?: number; clientY?: number };
  return { x: ev.clientX ?? 0, y: ev.clientY ?? 0 };
}

/** A rect with no drawable area (e.g. a `display:none` element reports 0×0). */
function isZeroArea(rect: ViewRect): boolean {
  return rect.width <= 0 && rect.height <= 0;
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
