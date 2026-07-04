/**
 * Guest email capture modal (0036 / U11).
 *
 * Shown before a guest's first comment submits. Unverified and low-friction (no
 * sign-in, no password) per the product: the email is what lets a client track
 * replies to their own comments and see the pages they commented on, and a
 * developer can correct a typo later from the dashboard. Browsing is allowed
 * without it; submitting a first comment is not. Requires a plausible address
 * (the confirm button stays disabled otherwise).
 */
import { enterCard, exitCard, fadeIn } from "../shell/motion.js";
import { normalizeEmail } from "./store.js";

const MODAL_TITLE = "Add your email to comment";
const MODAL_HINT =
  "No sign-in needed. Your email lets you follow replies to your comments across pages. You can change it anytime.";

export interface GuestEmailModalCallbacks {
  onConfirm(email: string): void;
  onCancel(): void;
}

export class GuestEmailModal {
  private readonly backdrop: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly confirmBtn: HTMLButtonElement;
  private destroyed = false;

  constructor(
    doc: Document,
    parent: HTMLElement,
    callbacks: GuestEmailModalCallbacks,
    initialEmail = "",
  ) {
    this.backdrop = doc.createElement("div");
    this.backdrop.className = "sc-modal-backdrop";

    const modal = doc.createElement("div");
    modal.className = "sc-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-label", MODAL_TITLE);

    const heading = doc.createElement("h2");
    heading.textContent = MODAL_TITLE;

    const hint = doc.createElement("div");
    hint.className = "sc-modal-hint";
    hint.textContent = MODAL_HINT;

    this.input = doc.createElement("input");
    this.input.type = "email";
    this.input.placeholder = "you@example.com";
    this.input.value = initialEmail;
    this.input.setAttribute("aria-label", "Your email");
    this.input.autocomplete = "email";

    const actions = doc.createElement("div");
    actions.className = "sc-form-actions";

    const cancel = doc.createElement("button");
    cancel.type = "button";
    cancel.className = "sc-btn-secondary";
    cancel.textContent = "Not now";
    cancel.addEventListener("click", () => callbacks.onCancel());

    this.confirmBtn = doc.createElement("button");
    this.confirmBtn.type = "button";
    this.confirmBtn.className = "sc-btn-primary";
    this.confirmBtn.textContent = "Continue";
    this.confirmBtn.addEventListener("click", () => this.tryConfirm(callbacks));

    actions.append(cancel, this.confirmBtn);

    this.input.addEventListener("input", () => this.syncConfirmState());
    this.input.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === "Enter") this.tryConfirm(callbacks);
    });

    modal.append(heading, hint, this.input, actions);
    this.backdrop.appendChild(modal);
    parent.appendChild(this.backdrop);

    fadeIn(this.backdrop);
    enterCard(modal, 10);

    this.syncConfirmState();
    this.input.focus();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    const done = exitCard(this.backdrop);
    if (done) void done.then(() => this.backdrop.remove());
    else this.backdrop.remove();
  }

  private tryConfirm(callbacks: GuestEmailModalCallbacks): void {
    const email = normalizeEmail(this.input.value);
    if (!email) return;
    callbacks.onConfirm(email);
  }

  private syncConfirmState(): void {
    this.confirmBtn.disabled = normalizeEmail(this.input.value) === null;
  }
}
