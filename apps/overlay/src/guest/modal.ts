/**
 * Lightweight "who's reviewing?" modal (R5 / R24 guest identity).
 *
 * Shown before the first comment submits when no name is stored. Browsing is
 * allowed without a name; submitting is not. The name is required (empty input
 * keeps the confirm button disabled).
 */
const MODAL_TITLE = "Add your name to comment";
const MODAL_HINT = "Your teammates will see this name on your comments.";

export interface GuestModalCallbacks {
  onConfirm(name: string): void;
  onCancel(): void;
}

export class GuestModal {
  private readonly backdrop: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly confirmBtn: HTMLButtonElement;

  constructor(
    doc: Document,
    parent: HTMLElement,
    callbacks: GuestModalCallbacks,
    initialName = "",
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
    hint.className = "sc-chip";
    hint.textContent = MODAL_HINT;

    this.input = doc.createElement("input");
    this.input.type = "text";
    this.input.placeholder = "e.g. Alex Rivera";
    this.input.value = initialName;
    this.input.setAttribute("aria-label", "Your name");

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

    this.syncConfirmState();
    this.input.focus();
  }

  destroy(): void {
    this.backdrop.remove();
  }

  private tryConfirm(callbacks: GuestModalCallbacks): void {
    const name = this.input.value.trim();
    if (!name) return;
    callbacks.onConfirm(name);
  }

  private syncConfirmState(): void {
    this.confirmBtn.disabled = this.input.value.trim().length === 0;
  }
}
