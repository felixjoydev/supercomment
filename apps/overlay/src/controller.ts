/**
 * Overlay controller — wires the shell, toolbar, selection state, comment form,
 * guest modal, and markers together and owns the interaction flow:
 *
 *   pick mode -> make a selection -> (ensure guest name) -> fill the form ->
 *   submit -> capture context (U7 seam) -> submit payload (U5 seam) -> drop a
 *   numbered marker.
 *
 * All DOM lives inside the shadow root from `shell/root.ts`, so the overlay is
 * isolated from the host app (design-lens D-01). Esc cancels any in-progress
 * selection/form without creating a comment.
 */
import type {
  NewCommentInput,
  CapturedContext,
} from "@supercomment/shared";
import { newCommentInputSchema } from "@supercomment/shared";
import {
  type CommentDraft,
  type ExistingCommentMarker,
  type OverlayConfig,
  type Rect,
  type SelectionMode,
  type SelectionTarget,
} from "./core/types.js";
import { createShellRoot, type ShellRoot } from "./shell/root.js";
import { Toolbar } from "./toolbar/toolbar.js";
import { SelectionState, type RectFor } from "./selection/state.js";
import { HighlightLayer } from "./selection/highlight.js";
import { CommentForm } from "./selection/form.js";
import { GuestModal } from "./guest/modal.js";
import { GuestNameStore } from "./guest/store.js";
import { MarkerLayer, type PlacedMarker } from "./markers/render.js";
import { resolveAnchors } from "./capture/reanchor.js";
import { attachBeforeArtifact } from "./capture/screenshot.js";

/**
 * U8: how many times re-anchoring retries an unresolved comment across animation
 * frames before declaring it stale. CSR/SPA apps render content AFTER the overlay
 * activates, so a comment whose element is merely late (not gone) gets a short
 * settle window (~N frames) rather than being falsely marked stale on frame 0.
 */
const REANCHOR_MAX_ATTEMPTS = 10;

/** Convert a DOMRect-ish to our plain Rect (viewport coordinates). */
function toRect(r: {
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

/** The element a "before" artifact should target, if any (U9/R15). */
function primaryElementOfTarget(target: SelectionTarget): Element | null {
  switch (target.kind) {
    case "element":
      return target.element;
    case "multi":
      return target.elements[0] ?? null;
    case "text":
    case "area":
      return null;
  }
}

export class OverlayController {
  private readonly doc: Document;
  private readonly shell: ShellRoot;
  private readonly toolbar: Toolbar;
  private readonly selection: SelectionState;
  private readonly highlights: HighlightLayer;
  private readonly markers: MarkerLayer;
  private readonly guestStore: GuestNameStore;

  private form: CommentForm | null = null;
  private modal: GuestModal | null = null;
  /** A selection + draft waiting on a guest name before submission. */
  private deferredTarget: SelectionTarget | null = null;
  private deferredDraft: CommentDraft | null = null;

  private readonly rectFor: RectFor;

  constructor(private readonly config: OverlayConfig) {
    this.doc = config.doc ?? document;
    this.shell = createShellRoot(this.doc);

    this.rectFor = (el) => toRect(el.getBoundingClientRect());
    this.selection = new SelectionState(this.rectFor);

    this.highlights = new HighlightLayer(this.doc, this.shell.layer);
    this.markers = new MarkerLayer(this.doc, this.shell.layer);
    this.guestStore = new GuestNameStore(config.previewKey, config.storage);

    this.toolbar = new Toolbar(this.doc, this.shell.layer, {
      onModeChange: (m) => this.changeMode(m),
      onConfirmMulti: () => this.confirmMulti(),
      onChangeName: () => this.promptForName(null),
    });
    this.toolbar.setMode(this.selection.getMode());
    this.toolbar.setReviewerName(this.guestStore.get());

    this.bindEvents();
  }

  /** Remove the overlay from the page. */
  destroy(): void {
    this.shell.destroy();
  }

  /**
   * U8 (re-anchor on activate): render markers for the preview's EXISTING
   * comments, loaded back after the overlay activates on the live deploy (R12,
   * R13). Each comment's live element is re-resolved from its captured
   * multi-anchor set against the CURRENT DOM:
   *
   *   - resolved  → marker placed at the element's CURRENT rect (document coords);
   *   - stale     → marker kept VISIBLE in the distinct stale state at a
   *                 best-effort position (its last-known capture box, else top),
   *                 rather than silently dropped or mis-anchored to the wrong
   *                 element (the resolver never guesses a non-unique match).
   *
   * Stale-ness is recomputed client-side from the anchors here (the server
   * `isStale` flag is not consulted); persisting it server-side is deferred.
   *
   * Fire-and-forget: the async retry settle (below) must never reject into the
   * host page, so failures are swallowed (the caller also fails closed).
   */
  loadExistingComments(comments: ExistingCommentMarker[]): void {
    void this.reanchorExistingComments(comments).catch(() => {});
  }

  /**
   * Resolve + place existing comments, retrying the not-yet-resolvable ones
   * across a few animation frames so late-rendered CSR/SPA content is not
   * falsely marked stale. The first pass is synchronous, so comments whose
   * elements are already in the DOM render immediately; only genuinely missing
   * ones wait out the settle window before going stale.
   */
  private async reanchorExistingComments(
    comments: ExistingCommentMarker[],
  ): Promise<void> {
    let pending = comments;
    for (let attempt = 0; ; attempt++) {
      const resolved: PlacedMarker[] = [];
      const unresolved: ExistingCommentMarker[] = [];
      for (const c of pending) {
        const { element } = resolveAnchors(c.anchors, this.doc);
        if (element) {
          resolved.push({ number: c.number, rect: this.documentRect(element) });
        } else {
          unresolved.push(c);
        }
      }
      if (resolved.length > 0) this.markers.addMany(resolved);
      pending = unresolved;
      if (pending.length === 0) return;
      if (attempt >= REANCHOR_MAX_ATTEMPTS) break;
      await this.nextFrame();
    }

    // Settle window exhausted: the rest are stale but kept visible.
    this.markers.addMany(
      pending.map((c) => ({
        number: c.number,
        rect: c.rect ?? { x: 0, y: 0, width: 0, height: 0 },
        isStale: true,
      })),
    );
  }

  /** A live element's rect in DOCUMENT coordinates (viewport rect + scroll). */
  private documentRect(el: Element): Rect {
    const r = el.getBoundingClientRect();
    const view = this.doc.defaultView;
    const sx = view?.scrollX ?? view?.pageXOffset ?? 0;
    const sy = view?.scrollY ?? view?.pageYOffset ?? 0;
    return {
      x: (r.x ?? r.left) + sx,
      y: (r.y ?? r.top) + sy,
      width: r.width,
      height: r.height,
    };
  }

  /** Resolve on the next animation frame (or a macrotask in non-browser envs). */
  private nextFrame(): Promise<void> {
    return new Promise((resolve) => {
      const view = this.doc.defaultView;
      if (view && typeof view.requestAnimationFrame === "function") {
        view.requestAnimationFrame(() => resolve());
      } else {
        setTimeout(() => resolve(), 0);
      }
    });
  }

  // --- Mode handling ------------------------------------------------------

  changeMode(mode: SelectionMode): void {
    this.dismissForm();
    this.selection.setMode(mode);
    this.highlights.clear();
    this.toolbar.setMode(mode);
    this.toolbar.setMultiCount(0);
  }

  // --- Selection entry points (called by event handlers) ------------------

  /** Element mode: select one element and open the form. */
  handleElementClick(el: Element): void {
    const target = this.selection.selectElement(el);
    this.highlights.showElements([target.rect]);
    this.openFormForTarget(target);
  }

  /** Multi mode: toggle membership; clicking a selected element deselects it. */
  handleMultiClick(el: Element): void {
    this.selection.toggleMulti(el);
    const rects = this.selection
      .getMultiSelection()
      .map((e) => this.rectFor(e));
    this.highlights.showElements(rects);
    this.toolbar.setMultiCount(this.selection.multiCount());
  }

  /** Multi mode confirm ("Annotate N") — one comment for the whole set. */
  confirmMulti(): void {
    const target = this.selection.confirmMulti();
    if (!target) return;
    this.openFormForTarget(target);
  }

  /** Area mode drag lifecycle. */
  beginArea(x: number, y: number): void {
    this.selection.beginAreaDrag(x, y);
  }

  updateArea(x: number, y: number): void {
    if (!this.selection.isDragging()) return;
    // Live rubber-band feedback while the drag is in progress.
    const start = this.selection.getDragStart();
    if (!start) return;
    this.highlights.showArea({
      x: Math.min(start.x, x),
      y: Math.min(start.y, y),
      width: Math.abs(x - start.x),
      height: Math.abs(y - start.y),
    });
  }

  endArea(x: number, y: number): void {
    const target = this.selection.endAreaDrag(x, y);
    if (!target) {
      this.highlights.clear();
      return;
    }
    this.highlights.showArea(target.rect);
    this.openFormForTarget(target);
  }

  /** Text mode: capture the current text selection. */
  handleTextSelection(quotedText: string, rect: Rect): void {
    const target = this.selection.selectText(quotedText, rect);
    if (!target) return;
    this.openFormForTarget(target, quotedText);
  }

  // --- Form + guest gate --------------------------------------------------

  private openFormForTarget(target: SelectionTarget, seedNote?: string): void {
    // Guest gate: a name is required before submitting (R5/R24). We open the
    // form regardless (browsing/drafting is fine) and only block at submit if
    // still nameless — but if there is no name at all we prompt up-front so the
    // reviewer isn't surprised.
    this.dismissForm();
    this.form = new CommentForm(this.doc, this.shell.layer, target.rect, {
      onSubmit: (draft) => this.handleSubmit(target, draft),
      onCancel: () => this.cancelSelection(),
    });
    if (seedNote) this.form.setNote(seedNote);
  }

  private handleSubmit(target: SelectionTarget, draft: CommentDraft): void {
    if (!this.guestStore.has()) {
      // Defer the submission until a name is provided.
      this.deferredTarget = target;
      this.deferredDraft = draft;
      this.promptForName(() => this.completeSubmit(target, draft));
      return;
    }
    void this.completeSubmit(target, draft);
  }

  private async completeSubmit(
    target: SelectionTarget,
    draft: CommentDraft,
  ): Promise<void> {
    const name = this.guestStore.get();
    if (!name) return; // still no name -> stay blocked

    const context = await this.captureContext(target);

    // U9 (R15): guarantee a per-comment, ELEMENT-scoped "before" artifact is
    // attached AT SUBMIT. The injected capturer normally fills
    // `context.screenshot` (an element raster when a rasterizer is wired, else an
    // element-subtree DOM snapshot); this backstop covers a capturer that didn't,
    // using the snapshot fallback. It is fully best-effort and NEVER throws, so a
    // raster/snapshot failure can never block submission.
    await attachBeforeArtifact(context, primaryElementOfTarget(target));

    const payload: NewCommentInput = newCommentInputSchema.parse({
      previewId: this.config.previewId,
      authorDisplayName: name,
      intent: draft.intent,
      severity: draft.severity,
      note: draft.note.trim(),
      context,
      fidelity: "live",
    });

    const result = await this.config.submitter.submit(payload);
    if (result.ok) {
      this.markers.add({ number: result.number, rect: target.rect });
    }
    this.cancelSelection();
  }

  private async captureContext(
    target: SelectionTarget,
  ): Promise<CapturedContext> {
    return this.config.capturer.capture(target);
  }

  // --- Guest name ---------------------------------------------------------

  /**
   * Open the guest-name modal. `onDone` (if given) runs after a name is saved,
   * letting a blocked submission continue.
   */
  promptForName(onDone: (() => void) | null): void {
    this.dismissModal();
    this.modal = new GuestModal(
      this.doc,
      this.shell.layer,
      {
        onConfirm: (name) => {
          const saved = this.guestStore.set(name);
          this.toolbar.setReviewerName(saved);
          this.dismissModal();
          if (onDone) onDone();
        },
        onCancel: () => this.dismissModal(),
      },
      this.guestStore.get() ?? "",
    );
  }

  // --- Cancellation -------------------------------------------------------

  /** Esc / cancel: drop the in-progress selection + form without committing. */
  cancelSelection(): void {
    this.dismissForm();
    this.dismissModal();
    this.selection.clear();
    this.highlights.clear();
    this.deferredTarget = null;
    this.deferredDraft = null;
    if (this.selection.getMode() === "multi") {
      this.toolbar.setMultiCount(0);
    }
  }

  private dismissForm(): void {
    this.form?.destroy();
    this.form = null;
  }

  private dismissModal(): void {
    this.modal?.destroy();
    this.modal = null;
  }

  // --- Native event wiring ------------------------------------------------

  private bindEvents(): void {
    const view = this.doc.defaultView;
    if (!view) return;

    // Escape is the only global key. Single-letter mode shortcuts were removed
    // deliberately: Shadow DOM retargets keydowns from our own form to the
    // shadow host, so a naive "am I typing?" guard cannot see the textarea and
    // letters typed into the note field would switch modes and destroy the
    // draft. Modes are mouse-driven from the toolbar.
    this.doc.addEventListener("keydown", (e) => {
      const ke = e as KeyboardEvent;
      if (ke.key === "Escape") this.cancelSelection();
    });

    // Clicks on the host page drive element/multi selection. We listen in the
    // host document (not the shadow layer) and ignore clicks on our own UI.
    this.doc.addEventListener(
      "click",
      (e) => {
        const target = e.target as Element | null;
        if (!target || this.isOwnNode(target)) return;
        const mode = this.selection.getMode();
        if (mode === "element") {
          e.preventDefault();
          this.handleElementClick(target);
        } else if (mode === "multi") {
          e.preventDefault();
          this.handleMultiClick(target);
        }
      },
      true,
    );

    // Area drag in area mode.
    this.doc.addEventListener("mousedown", (e) => {
      if (this.selection.getMode() !== "area") return;
      const me = e as MouseEvent;
      if (this.isOwnNode(me.target as Element | null)) return;
      this.beginArea(me.clientX, me.clientY);
    });
    this.doc.addEventListener("mousemove", (e) => {
      const me = e as MouseEvent;
      this.updateArea(me.clientX, me.clientY);
    });
    this.doc.addEventListener("mouseup", (e) => {
      if (this.selection.getMode() !== "area") return;
      const me = e as MouseEvent;
      this.endArea(me.clientX, me.clientY);
    });

    // Text mode: grab the current selection on mouseup.
    this.doc.addEventListener("mouseup", () => {
      if (this.selection.getMode() !== "text") return;
      const sel = view.getSelection?.();
      const text = sel?.toString() ?? "";
      if (!text.trim()) return;
      const range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
      const rect = range
        ? toRect(range.getBoundingClientRect())
        : { x: 0, y: 0, width: 0, height: 0 };
      this.handleTextSelection(text, rect);
    });

    // Keep markers anchored on scroll/resize.
    view.addEventListener("scroll", () => this.markers.render(), true);
    view.addEventListener("resize", () => this.markers.render());
  }

  /** True if a node belongs to our own overlay (shadow host). */
  private isOwnNode(node: Element | null): boolean {
    if (!node) return false;
    return node.closest?.(`#${this.shell.host.id}`) === this.shell.host
      ? true
      : this.shell.host.contains(node);
  }
}
