/**
 * The comment form: note + intent + severity (R10), anchored near the
 * selection with an edge-aware fallback so it never spills off-screen. Can be
 * dismissed without saving. The form knows nothing about submission transport;
 * it just collects a `CommentDraft` and reports submit/cancel via callbacks.
 */
import type { Intent, Severity } from "@supercomment/shared";
import { intentSchema, severitySchema } from "@supercomment/shared";
import type { CommentDraft, Rect } from "../core/types.js";
import { enterCard, exitCard } from "../shell/motion.js";

const FORM_WIDTH = 320;
const FORM_MARGIN = 12;
/** Rough height used for edge-aware vertical placement before measuring. */
const FORM_EST_HEIGHT = 260;

export interface CommentFormCallbacks {
  onSubmit(draft: CommentDraft): void;
  onCancel(): void;
}

export class CommentForm {
  private readonly el: HTMLElement;
  private readonly textarea: HTMLTextAreaElement;
  private readonly submitBtn: HTMLButtonElement;
  private intent: Intent = "change";
  private severity: Severity = "important";
  private flippedAbove = false;
  private destroyed = false;

  constructor(
    private readonly doc: Document,
    parent: HTMLElement,
    anchor: Rect,
    private readonly callbacks: CommentFormCallbacks,
  ) {
    this.el = doc.createElement("div");
    this.el.className = "sc-form";
    this.el.setAttribute("role", "dialog");
    this.el.setAttribute("aria-label", "Add comment");

    this.textarea = doc.createElement("textarea");
    this.textarea.placeholder = "Describe what should change…";
    this.textarea.setAttribute("aria-label", "Comment note");

    const intentRow = this.buildSegmented(
      "Intent",
      intentSchema.options,
      (v) => {
        this.intent = v as Intent;
      },
      this.intent,
    );
    const severityRow = this.buildSegmented(
      "Severity",
      severitySchema.options,
      (v) => {
        this.severity = v as Severity;
      },
      this.severity,
    );

    const actions = doc.createElement("div");
    actions.className = "sc-form-actions";

    const cancel = doc.createElement("button");
    cancel.type = "button";
    cancel.className = "sc-btn-secondary";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => this.callbacks.onCancel());

    this.submitBtn = doc.createElement("button");
    this.submitBtn.type = "button";
    this.submitBtn.className = "sc-btn-primary";
    this.submitBtn.textContent = "Comment";
    this.submitBtn.disabled = true;
    this.submitBtn.addEventListener("click", () => this.trySubmit());

    actions.append(cancel, this.submitBtn);

    this.textarea.addEventListener("input", () => this.syncSubmitState());

    this.el.append(this.textarea, intentRow, severityRow, actions);
    parent.appendChild(this.el);

    this.place(anchor);
    // Scale in from the side facing the selection, never from nothing.
    this.el.style.transformOrigin = this.flippedAbove ? "bottom center" : "top center";
    enterCard(this.el, this.flippedAbove ? -8 : 8);
    this.textarea.focus();
  }

  /** Read the current draft. */
  getDraft(): CommentDraft {
    return {
      note: this.textarea.value,
      intent: this.intent,
      severity: this.severity,
    };
  }

  /** Programmatically set the note (used by text mode to seed the quote). */
  setNote(note: string): void {
    this.textarea.value = note;
    this.syncSubmitState();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    // Exits are softer and faster than enters; remove after the fade. When no
    // animation can run, remove synchronously.
    const done = exitCard(this.el);
    if (done) void done.then(() => this.el.remove());
    else this.el.remove();
  }

  private trySubmit(): void {
    const draft = this.getDraft();
    if (draft.note.trim().length === 0) return;
    this.callbacks.onSubmit(draft);
  }

  private syncSubmitState(): void {
    this.submitBtn.disabled = this.textarea.value.trim().length === 0;
  }

  private buildSegmented(
    label: string,
    options: readonly string[],
    onPick: (value: string) => void,
    initial: string,
  ): HTMLElement {
    const wrap = this.doc.createElement("div");
    const lbl = this.doc.createElement("div");
    lbl.className = "sc-field-label";
    lbl.textContent = label;
    const group = this.doc.createElement("div");
    group.className = "sc-segmented";
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", label);

    const buttons: HTMLButtonElement[] = [];
    for (const opt of options) {
      const btn = this.doc.createElement("button");
      btn.type = "button";
      btn.className = "sc-seg";
      btn.textContent = opt;
      btn.setAttribute("data-value", opt);
      btn.setAttribute("aria-pressed", String(opt === initial));
      btn.addEventListener("click", () => {
        onPick(opt);
        for (const b of buttons) {
          b.setAttribute("aria-pressed", String(b === btn));
        }
      });
      buttons.push(btn);
      group.appendChild(btn);
    }
    wrap.append(lbl, group);
    return wrap;
  }

  /** Edge-aware placement: prefer below-right of the anchor, flip when tight. */
  private place(anchor: Rect): void {
    const view = this.doc.defaultView;
    const vw = view?.innerWidth ?? this.doc.documentElement.clientWidth ?? 1024;
    const vh =
      view?.innerHeight ?? this.doc.documentElement.clientHeight ?? 768;

    let left = anchor.x;
    if (left + FORM_WIDTH + FORM_MARGIN > vw) {
      left = vw - FORM_WIDTH - FORM_MARGIN;
    }
    left = Math.max(FORM_MARGIN, left);

    let top = anchor.y + anchor.height + FORM_MARGIN;
    if (top + FORM_EST_HEIGHT + FORM_MARGIN > vh) {
      // Flip above the anchor when there isn't room below.
      top = anchor.y - FORM_EST_HEIGHT - FORM_MARGIN;
      this.flippedAbove = true;
    }
    top = Math.max(FORM_MARGIN, top);

    this.el.style.left = `${left}px`;
    this.el.style.top = `${top}px`;
  }
}
