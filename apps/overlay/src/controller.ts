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
  ChangeOp,
  DeviceSurface,
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
import { ConfirmModal } from "./shell/confirm.js";
import { SelectionState, type RectFor } from "./selection/state.js";
import { HighlightLayer } from "./selection/highlight.js";
import { CommentForm } from "./selection/form.js";
import { GuestModal } from "./guest/modal.js";
import { GuestNameStore } from "./guest/store.js";
import { MarkerLayer, type PlacedMarker } from "./markers/render.js";
import { resolveAnchors } from "./capture/reanchor.js";
import { attachBeforeArtifact } from "./capture/screenshot.js";
import { EditSession, opKey } from "./editor/edit-session.js";
import { buildEditTarget } from "./editor/edit-target.js";
import { PropertiesPanel } from "./editor/panel.js";
import { PreviewLog } from "./editor/preview-log.js";
import { InspectorLayer } from "./editor/inspector.js";
import { beginInlineTextEdit } from "./editor/inline-text.js";
import { applyTextPreview, buildTextOp } from "./editor/style-edits.js";
import { DeviceMode } from "./device/device-mode.js";
import { DeviceToolbar } from "./device/device-toolbar.js";
import { filterBySurface, countBySurface } from "./device/surface-filter.js";

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

  /**
   * The durable visual-edit buffer (U9). Lives on the controller — not the
   * selection state — so it survives setMode/clear/Esc (G13/R7); it is discarded
   * only on an explicit reviewer action, never by mode churn.
   */
  readonly editSession: EditSession;
  /**
   * Ephemeral-preview reverts for the visual editor (kept in lockstep with
   * `editSession` by op key). Lives on the controller so previews across EVERY
   * edited element can be reverted on close/discard, not just the current one
   * (baked-in decision: previews are ephemeral). Empty outside edit mode.
   */
  private readonly previewLog = new PreviewLog();
  /** The in-page element inspector (tag badge + dims + spacing pills), R-D. */
  private readonly inspector: InspectorLayer;
  /** Teardown callbacks for every listener this controller binds (plans/008). */
  private readonly disposers: Array<() => void> = [];

  private form: CommentForm | null = null;
  private modal: GuestModal | null = null;
  /** The Exit-confirmation dialog (U18); open only while confirming exit. */
  private confirmModal: ConfirmModal | null = null;
  /** The visual-editor properties panel (U9); open only while editing an element. */
  private editPanel: PropertiesPanel | null = null;
  /** A selection + draft waiting on a guest name before submission. */
  private deferredTarget: SelectionTarget | null = null;
  private deferredDraft: CommentDraft | null = null;

  /** Responsive device-mode (top-level controllers only; null in the iframe child). */
  private readonly deviceMode: DeviceMode | null;
  private readonly deviceToolbar: DeviceToolbar | null;
  /** The device surface this controller renders markers for ("web" for the top-level). */
  private readonly surface: DeviceSurface;
  /** All loaded existing comments (every surface); markers are filtered per surface. */
  private existingComments: ExistingCommentMarker[] = [];
  /** Live per-surface comment counts for the device toggle badges (top-level only). */
  private surfaceCounts: Record<DeviceSurface, number> = {
    web: 0,
    mobile: 0,
    tablet: 0,
    responsive: 0,
  };

  private readonly rectFor: RectFor;

  constructor(private readonly config: OverlayConfig) {
    this.doc = config.doc ?? document;
    this.surface = config.surface ?? "web";
    this.shell = createShellRoot(this.doc);

    this.rectFor = (el) => toRect(el.getBoundingClientRect());
    this.selection = new SelectionState(this.rectFor);

    this.highlights = new HighlightLayer(this.doc, this.shell.layer);
    this.markers = new MarkerLayer(this.doc, this.shell.layer);
    this.inspector = new InspectorLayer(this.doc, this.shell.layer);
    this.guestStore = new GuestNameStore(config.previewKey, config.storage);

    this.toolbar = new Toolbar(this.doc, this.shell.layer, {
      onModeChange: (m) => this.changeMode(m),
      onConfirmMulti: () => this.confirmMulti(),
      onChangeName: () => this.promptForName(null),
      // Exit ends the whole review session; never on the device-mode child
      // (which shares the parent's session and lives inside the iframe).
      ...(config.deviceChild ? {} : { onExit: () => this.requestExit() }),
    });
    this.toolbar.setMode(this.selection.getMode());
    this.toolbar.setReviewerName(this.guestStore.get());

    // Responsive device-mode toolbar — top-level controllers only. The child
    // controller mounted inside the device iframe must not nest its own.
    if (!config.deviceChild) {
      this.deviceMode = new DeviceMode({
        doc: this.doc,
        container: this.shell.layer,
        mountChild: (childDoc, preset) => {
          const child = new OverlayController({
            ...this.config,
            doc: childDoc,
            deviceChild: true,
            surface: preset.surface,
            // Route the child's submits back so the parent's toggle counts stay live.
            onCommentSubmitted: (s) => this.bumpSurfaceCount(s),
          });
          // Hand the child the full comment set; it renders only its own surface.
          child.loadExistingComments(this.existingComments);
          return child;
        },
        onError: (message) => this.showDeviceNotice(message),
        onChange: (preset) => this.deviceToolbar?.setActive(preset),
      });
      this.deviceToolbar = new DeviceToolbar(this.doc, this.shell.layer, {
        onSelect: (preset) => {
          if (preset.surface === "web") {
            this.deviceMode?.exit();
          } else {
            this.deviceMode?.enter(preset);
          }
        },
      });
    } else {
      this.deviceMode = null;
      this.deviceToolbar = null;
    }

    this.editSession = new EditSession();
    this.bindEvents();
  }

  /**
   * Remove the overlay from the page and unbind every listener it registered
   * (plans/008). Full teardown drops the edit buffer too — unlike Esc, which
   * dismisses the panel UI but preserves the buffer (G13).
   */
  destroy(): void {
    for (const dispose of this.disposers.splice(0)) {
      try {
        dispose();
      } catch {
        /* teardown is best-effort — one failure must not skip the rest */
      }
    }
    this.dismissEditPanel();
    // Ephemeral visual edits must not outlive the overlay — restore the host
    // page's inline styles before we detach.
    this.previewLog.revertAll();
    this.inspector.hide();
    this.dismissConfirm();
    this.deviceMode?.exit();
    this.shell.destroy();
  }

  /** Briefly surface a device-mode error inside the overlay (auto-dismisses). */
  private showDeviceNotice(message: string): void {
    const notice = this.doc.createElement("div");
    notice.className = "sc-device-notice";
    notice.setAttribute("role", "status");
    notice.textContent = message;
    this.shell.layer.appendChild(notice);
    const view = this.doc.defaultView;
    // Best-effort auto-dismiss: the notice still shows if a timer can't schedule.
    view?.setTimeout?.(() => notice.remove(), 4000);
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
    this.existingComments = comments;
    // The toggle badges count comments across ALL surfaces; the markers we
    // actually place are filtered to THIS controller's surface so a mobile
    // comment never shows on desktop (and vice versa).
    this.refreshSurfaceCounts();
    const mine = filterBySurface(comments, this.surface);
    void this.reanchorExistingComments(mine).catch(() => {});
  }

  /** Recompute per-surface counts from the loaded set and push to the toolbar. */
  private refreshSurfaceCounts(): void {
    if (!this.deviceToolbar) return;
    this.surfaceCounts = countBySurface(this.existingComments);
    this.deviceToolbar.setCounts(this.surfaceCounts);
  }

  /** Increment one surface's count (a new comment) and update the toggles. */
  private bumpSurfaceCount(surface: DeviceSurface): void {
    if (!this.deviceToolbar) return;
    this.surfaceCounts[surface] = (this.surfaceCounts[surface] ?? 0) + 1;
    this.deviceToolbar.setCounts(this.surfaceCounts);
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
          resolved.push({
            number: c.number,
            rect: this.documentRect(element),
            content: c.content,
          });
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
        content: c.content,
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
    // Leaving (or re-entering) a mode closes the editor and reverts its ephemeral
    // previews (the DOM resets), but KEEPS the edit buffer — the reviewer can
    // switch modes mid-edit and come back (G13). The durable change-set is intact.
    this.closeEditor();
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

  /**
   * Edit mode (U9): select an element and open the properties panel bound to it,
   * instead of the comment form. The edit buffer already lives on the controller,
   * so re-targeting a different element keeps every prior edit.
   */
  handleEditClick(el: Element): void {
    this.selection.selectElement(el);
    // In edit mode the magenta in-page inspector box IS the selection indicator
    // (matching the reference), so we don't also draw the persimmon highlight.
    this.openEditPanel(el);
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
    this.openFormForTarget(target, { seedNote: quotedText });
  }

  // --- Form + guest gate --------------------------------------------------

  private openFormForTarget(
    target: SelectionTarget,
    opts: { seedNote?: string; asTemplate?: boolean } = {},
  ): void {
    // Guest gate: a name is required before submitting (R5/R24). We open the
    // form regardless (browsing/drafting is fine) and only block at submit if
    // still nameless — but if there is no name at all we prompt up-front so the
    // reviewer isn't surprised.
    this.dismissForm();
    this.form = new CommentForm(
      this.doc,
      this.shell.layer,
      target.rect,
      {
        onSubmit: (draft) =>
          this.handleSubmit(target, draft, opts.asTemplate ?? false),
        onCancel: () => this.cancelSelection(),
      },
      { readFile: this.config.readFile },
    );
    if (opts.seedNote) this.form.setNote(opts.seedNote);
  }

  private handleSubmit(
    target: SelectionTarget,
    draft: CommentDraft,
    asTemplate = false,
  ): void {
    if (!this.guestStore.has()) {
      // Defer the submission until a name is provided.
      this.deferredTarget = target;
      this.deferredDraft = draft;
      this.promptForName(() => this.completeSubmit(target, draft, asTemplate));
      return;
    }
    void this.completeSubmit(target, draft, asTemplate);
  }

  private async completeSubmit(
    target: SelectionTarget,
    draft: CommentDraft,
    asTemplate = false,
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
    const element = primaryElementOfTarget(target);
    await attachBeforeArtifact(context, element);

    // U13: fold the visual change-set into a `template` comment. ONLY a submit
    // that came from the editor's "Save as comment" carries the buffer — an
    // ordinary comment made while edits happen to be buffered must not absorb
    // them. captureContext already rastered the MODIFIED DOM (previews are still
    // applied at submit, before any framework revert — G6), so the screenshot is
    // the modified state (R17).
    const changeSet = asTemplate ? this.editSession.toChangeSet() : null;
    if (changeSet) {
      context.changeSet = changeSet;
    }

    // U13/U7 + U17/R19: push the real raster + any reference images out-of-band
    // to Storage in PARALLEL (independent I/O) and keep only their refs, so a
    // large PNG never inflates `context` (3 MiB cap) or every read.
    await Promise.all([
      this.uploadScreenshotRef(context, element),
      this.uploadReferenceImages(context),
    ]);

    const payload: NewCommentInput = newCommentInputSchema.parse({
      previewId: this.config.previewId,
      authorDisplayName: name,
      intent: draft.intent,
      severity: draft.severity,
      note: draft.note.trim(),
      context,
      fidelity: "live",
      ...(changeSet ? { kind: "template" as const } : {}),
    });

    const result = await this.config.submitter.submit(payload);
    if (!result.ok) {
      // U13/G5: SURFACE the rejection instead of swallowing it, and PRESERVE the
      // draft + edit buffer so the reviewer can trim/retry (rate_limited /
      // payload_too_large) or reload (no_review_session). Never cancel here.
      this.showSubmitError(result.message);
      return;
    }

    this.markers.add({
      number: result.number,
      rect: target.rect,
      content: {
        note: draft.note.trim(),
        authorDisplayName: name,
        intent: draft.intent,
        severity: draft.severity,
        status: "new",
        createdAt: new Date().toISOString(),
        // U16 (R11): a saved visual edit is a `template` — mark its pin distinctly.
        ...(changeSet ? { kind: "template" as const } : {}),
      },
    });
    // Keep the toggle counts live: update this controller's own toolbar (if
    // top-level) and notify the parent (if this is the device-iframe child).
    this.bumpSurfaceCount(this.surface);
    this.config.onCommentSubmitted?.(this.surface);
    // The edits are now saved as a comment (R7): clear the buffer so they don't
    // ride a subsequent unrelated comment.
    if (changeSet) this.editSession.discard();
    this.cancelSelection();
  }

  /**
   * Upload a modified-state raster out-of-band and swap the inline data URL for
   * its Storage ref (U13/U7). Only real `image/*` data URLs are uploaded — the
   * `data:application/json,...` DOM-snapshot fallback and existing refs stay as
   * they are. On upload failure the heavy inline raster is DROPPED rather than
   * shipped (it would risk the 3 MiB `context` cap); submission proceeds either
   * way. Never throws.
   */
  private async uploadScreenshotRef(
    context: CapturedContext,
    element: Element | null,
  ): Promise<void> {
    const uploader = this.config.uploader;
    const shot = context.screenshot;
    if (!uploader || !shot || !shot.startsWith("data:image/")) return;
    let ref: string | null = null;
    try {
      ref = await uploader.uploadDataUrl(shot);
    } catch {
      ref = null;
    }
    if (ref) {
      context.screenshot = ref;
      return;
    }
    // Upload failed: don't ship a heavy inline PNG (3 MiB cap), but don't lose the
    // before/modified artifact either — fall back to the small, capped DOM
    // snapshot so every comment still carries an artifact (R15).
    delete context.screenshot;
    await attachBeforeArtifact(context, element);
  }

  /**
   * Upload the composer's reference images out-of-band (U17/R19) and store their
   * Storage refs in `context.referenceImages`. Non-blocking + per-file: a failed
   * upload is skipped and submission proceeds. Without an uploader (tunnel/stub)
   * the images are dropped rather than inlined (they would bust the context cap).
   */
  private async uploadReferenceImages(context: CapturedContext): Promise<void> {
    const uploader = this.config.uploader;
    const dataUrls = this.form?.getReferenceImages() ?? [];
    if (!uploader || dataUrls.length === 0) return;
    const results = await Promise.all(
      dataUrls.map(async (dataUrl) => {
        try {
          return await uploader.uploadDataUrl(dataUrl);
        } catch {
          return null; // per-file, non-blocking: skip this image
        }
      }),
    );
    const refs = results.filter((r): r is string => !!r);
    if (refs.length > 0) context.referenceImages = refs;
  }

  /** Map a raw RPC rejection to a clear, actionable reviewer message (U13/G5/G21). */
  private mapSubmitError(message?: string): string {
    const m = (message ?? "").toLowerCase();
    if (m.includes("rate_limited")) {
      return "You're commenting too quickly. Wait a moment, then submit again.";
    }
    if (m.includes("payload_too_large")) {
      return "This edit is too large to save. Remove a few changes and submit again.";
    }
    if (m.includes("no_review_session") || m.includes("invalid_token")) {
      // The ~8h review session lapsed; a fresh token needs the /s hop (G21).
      return "Your review session has expired. Reload the page to keep reviewing.";
    }
    return "Couldn't save your comment. Please try again.";
  }

  /** Surface a submit rejection as a transient notice; the form + buffer stay put. */
  private showSubmitError(message?: string): void {
    this.showDeviceNotice(this.mapSubmitError(message));
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

  // --- Exit review session (U18) ------------------------------------------

  /**
   * Reviewer clicked "Exit". Confirm first — this is destructive: it ends the
   * session and closes the overlay — and warn about any unsaved visual edits.
   */
  private requestExit(): void {
    // Clear transient UI so the confirm dialog is the only thing up.
    this.dismissForm();
    this.dismissModal();
    this.closeEditor();
    this.markers.closePopover();
    this.dismissConfirm();

    const unsaved = !this.editSession.isEmpty();
    const body =
      (unsaved ? "You have unsaved edits that will be discarded. " : "") +
      "The toolbar will close on this site. To comment again, open the review " +
      "link the developer shared with you.";

    this.confirmModal = new ConfirmModal(this.doc, this.shell.layer, {
      title: "End review session?",
      body,
      confirmLabel: "Exit",
      cancelLabel: "Cancel",
      onConfirm: () => {
        this.dismissConfirm();
        this.performExit();
      },
      onCancel: () => this.dismissConfirm(),
    });
  }

  /**
   * Confirmed exit: clear the persisted session (side effect owned by the
   * embedded bootstrap via `config.onExit`), then fully tear the overlay down.
   * destroy() unbinds every listener, drops the edit buffer, and removes the
   * host, so the page returns to its normal state.
   */
  private performExit(): void {
    this.config.onExit?.();
    this.destroy();
  }

  private dismissConfirm(): void {
    this.confirmModal?.destroy();
    this.confirmModal = null;
  }

  // --- Cancellation -------------------------------------------------------

  /** Esc / cancel: drop the in-progress selection + form without committing. */
  cancelSelection(): void {
    this.dismissForm();
    this.dismissModal();
    // Esc also dismisses the Exit-confirmation dialog if it's open.
    this.dismissConfirm();
    // Esc closes the editor + reverts its ephemeral previews, but PRESERVES the
    // edit buffer (G13/R7) — the reviewer can reopen it by picking an element again.
    this.closeEditor();
    // Esc also closes an open comment popover (Shadow DOM retargets cross-boundary
    // clicks, so there is no doc-level "click outside" close — see bindEvents).
    this.markers.closePopover();
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

  // --- Visual editor (U9) -------------------------------------------------

  /**
   * Open (or re-target) the properties panel for `el`. The panel records edits
   * into {@link editSession} via callbacks and previews them ephemerally; the
   * durable artifact is the change-set folded into `context` at submit (U13).
   */
  private openEditPanel(el: Element): void {
    this.dismissForm();
    // UI-only teardown of any prior panel — previews for already-edited elements
    // persist (cumulative visual) since the reviewer is still in the session.
    this.dismissEditPanel();
    const target = buildEditTarget(el, this.doc);
    this.editPanel = new PropertiesPanel(this.doc, this.shell.layer, el, target, {
      record: (op, revert) => this.recordEdit(op, revert),
      removeEdit: (op) => this.removeEdit(op),
      undo: () => this.undoLastEdit(),
      discard: () => this.discardEdits(),
      count: () => this.editSession.size,
      onClose: () => this.closeEditor(),
      onSave: () => this.beginEditComment(el),
    });
    // The in-page inspector locks onto the selected element while editing.
    this.inspector.show(el);
  }

  /**
   * Record one edit into the durable buffer AND register its ephemeral preview
   * revert, keeping the two in lockstep: if the op just coalesced away to a net
   * no-op (e.g. a value nudged back to its original), revert + drop the preview.
   */
  private recordEdit(op: ChangeOp, revert?: () => void): void {
    this.editSession.record(op);
    const key = opKey(op);
    if (this.editSession.has(op)) {
      if (revert) this.previewLog.add(key, revert);
    } else {
      this.previewLog.revertKey(key);
    }
  }

  /** Drop a specific recorded edit and revert its ephemeral preview (toggle-off). */
  private removeEdit(op: ChangeOp): void {
    this.editSession.remove(op);
    this.previewLog.revertKey(opKey(op));
  }

  /** Footer Undo: remove the last recorded edit and revert its preview. */
  private undoLastEdit(): void {
    const op = this.editSession.undoLast();
    if (op) this.previewLog.revertKey(opKey(op));
  }

  /** Discard the whole buffer AND revert every ephemeral preview. */
  private discardEdits(): void {
    this.editSession.discard();
    this.previewLog.revertAll();
  }

  /**
   * Close the editor: tear down the panel UI, revert EVERY ephemeral preview
   * applied this session (the DOM resets — previews are ephemeral), and hide the
   * inspector. The edit buffer is PRESERVED (G13/R7); only the visual is undone.
   */
  private closeEditor(): void {
    this.dismissEditPanel();
    this.previewLog.revertAll();
    this.inspector.hide();
  }

  /**
   * Double-click inline text edit (requirement E): edit a text leaf's copy in
   * place and record a normalized `setText` with an ephemeral revert. No-op for
   * non-leaf elements (guarded in `beginInlineTextEdit`).
   */
  private beginInlineEdit(el: Element): void {
    const target = buildEditTarget(el, this.doc);
    beginInlineTextEdit(el, this.doc, {
      onCommit: (before, after) => {
        const next = after.replace(/\s+/g, " ").trim();
        if (next === before) return; // unchanged → record nothing
        this.recordEdit(buildTextOp(target, before, next), () =>
          applyTextPreview(el, before),
        );
      },
    });
  }

  /**
   * Finalize the buffered edits as a template comment (U13): open the comment
   * form anchored to the edited element so the reviewer adds a note; submitting
   * it folds the WHOLE change-set into a `template`. No-op when nothing's edited.
   */
  private beginEditComment(el: Element): void {
    if (this.editSession.isEmpty()) return;
    const target = this.selection.selectElement(el);
    this.dismissEditPanel();
    this.openFormForTarget(target, { asTemplate: true });
  }

  /** Close the editor panel UI. The edit buffer is NOT discarded here (G13/R7). */
  private dismissEditPanel(): void {
    this.editPanel?.destroy();
    this.editPanel = null;
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
    this.on(this.doc, "keydown", (e) => {
      const ke = e as KeyboardEvent;
      if (ke.key === "Escape") this.cancelSelection();
    });

    // Clicks on the host page drive element/multi/edit selection. We listen in
    // the host document (not the shadow layer) and ignore clicks on our own UI.
    this.on(
      this.doc,
      "click",
      (e) => {
        const target = e.target as Element | null;
        if (!target || this.isOwnNode(target)) return;
        const mode = this.selection.getMode();
        // Browse mode is passive: never preventDefault, so the click falls
        // through to the page and the reviewer navigates normally (links,
        // buttons, SPA routers). Pins stay clickable — they are our own nodes,
        // already excluded by the isOwnNode guard above.
        if (mode === "browse") return;
        if (mode === "element") {
          e.preventDefault();
          this.handleElementClick(target);
        } else if (mode === "multi") {
          e.preventDefault();
          this.handleMultiClick(target);
        } else if (mode === "edit") {
          e.preventDefault();
          this.handleEditClick(target);
        }
      },
      true,
    );

    // In-page inspector (requirement D): hovering reveals the element's tag
    // badge, dimensions, and spacing pills — in the passive Browse mode too, not
    // just Edit. While a panel is open the inspector is locked to the selection.
    this.on(
      this.doc,
      "mouseover",
      (e) => {
        const mode = this.selection.getMode();
        if (mode !== "browse" && mode !== "edit") return;
        if (this.editPanel) return; // locked onto the selected element
        const target = e.target as Element | null;
        if (!target || this.isOwnNode(target)) {
          this.inspector.hide();
          return;
        }
        this.inspector.show(target);
      },
      true,
    );

    // Double-click a text leaf in Edit mode → edit its copy inline (requirement E).
    this.on(
      this.doc,
      "dblclick",
      (e) => {
        if (this.selection.getMode() !== "edit") return;
        const target = e.target as Element | null;
        if (!target || this.isOwnNode(target)) return;
        e.preventDefault();
        this.beginInlineEdit(target);
      },
      true,
    );

    // Area drag in area mode.
    this.on(this.doc, "mousedown", (e) => {
      if (this.selection.getMode() !== "area") return;
      const me = e as MouseEvent;
      if (this.isOwnNode(me.target as Element | null)) return;
      this.beginArea(me.clientX, me.clientY);
    });
    this.on(this.doc, "mousemove", (e) => {
      const me = e as MouseEvent;
      this.updateArea(me.clientX, me.clientY);
    });
    this.on(this.doc, "mouseup", (e) => {
      if (this.selection.getMode() !== "area") return;
      const me = e as MouseEvent;
      this.endArea(me.clientX, me.clientY);
    });

    // Text mode: grab the current selection on mouseup.
    this.on(this.doc, "mouseup", () => {
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

    // Keep markers + the in-page inspector anchored on scroll/resize.
    this.on(
      view,
      "scroll",
      () => {
        this.markers.render();
        this.inspector.render();
      },
      true,
    );
    this.on(view, "resize", () => {
      this.markers.render();
      this.inspector.render();
    });
  }

  /**
   * Register an event listener and record its removal in {@link disposers} so
   * {@link destroy} fully unbinds it (plans/008). Every listener the controller
   * binds — including the edit-mode dispatch — goes through here.
   */
  private on(
    target: EventTarget,
    type: string,
    handler: (e: Event) => void,
    options?: boolean | AddEventListenerOptions,
  ): void {
    target.addEventListener(type, handler as EventListener, options);
    this.disposers.push(() =>
      target.removeEventListener(type, handler as EventListener, options),
    );
  }

  /** True if a node belongs to our own overlay (shadow host). */
  private isOwnNode(node: Element | null): boolean {
    if (!node) return false;
    return node.closest?.(`#${this.shell.host.id}`) === this.shell.host
      ? true
      : this.shell.host.contains(node);
  }
}
