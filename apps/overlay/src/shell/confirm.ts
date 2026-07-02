/**
 * A minimal confirm dialog (title + body + Cancel/Confirm), modeled on the
 * guest modal (`guest/modal.ts`) but with no input. Used for the Exit-review
 * confirmation (U18): confirming clears the session and tears the overlay down,
 * so the reviewer is warned — and told how to return — before committing.
 */
import { enterCard, exitCard, fadeIn } from "./motion.js";

export interface ConfirmModalOptions {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm(): void;
  onCancel(): void;
}

export class ConfirmModal {
  private readonly backdrop: HTMLElement;
  private destroyed = false;

  constructor(doc: Document, parent: HTMLElement, opts: ConfirmModalOptions) {
    this.backdrop = doc.createElement("div");
    this.backdrop.className = "sc-modal-backdrop";

    const modal = doc.createElement("div");
    modal.className = "sc-modal";
    modal.setAttribute("role", "alertdialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-label", opts.title);

    const heading = doc.createElement("h2");
    heading.textContent = opts.title;

    const body = doc.createElement("div");
    body.className = "sc-modal-hint";
    body.textContent = opts.body;

    const actions = doc.createElement("div");
    actions.className = "sc-form-actions";

    const cancel = doc.createElement("button");
    cancel.type = "button";
    cancel.className = "sc-btn-secondary";
    cancel.textContent = opts.cancelLabel;
    cancel.addEventListener("click", () => opts.onCancel());

    const confirm = doc.createElement("button");
    confirm.type = "button";
    confirm.className = "sc-btn-danger";
    confirm.textContent = opts.confirmLabel;
    confirm.addEventListener("click", () => opts.onConfirm());

    actions.append(cancel, confirm);
    modal.append(heading, body, actions);
    this.backdrop.appendChild(modal);
    parent.appendChild(this.backdrop);

    // Backdrop fades while the card settles in; both degrade to no-ops without
    // WAAPI (node / test env), matching the guest modal.
    fadeIn(this.backdrop);
    enterCard(modal, 10);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    const done = exitCard(this.backdrop);
    if (done) void done.then(() => this.backdrop.remove());
    else this.backdrop.remove();
  }
}
