/**
 * Session-lapsed panel (0039). When a review session lapses after inactivity, this
 * replaces the toolbar (which the controller hides, along with the pins) with a
 * clear message + Renew button. Renewing revives the session if the link is still
 * valid; otherwise the panel shows that access has ended.
 */
import { fadeIn } from "../shell/motion.js";

export interface SessionLapsePanelCallbacks {
  onRenew(): void | Promise<void>;
}

export class SessionLapsePanel {
  private readonly el: HTMLElement;
  private readonly msg: HTMLElement;
  private readonly btn: HTMLButtonElement;
  private destroyed = false;

  constructor(
    doc: Document,
    parent: HTMLElement,
    private readonly callbacks: SessionLapsePanelCallbacks,
  ) {
    this.el = doc.createElement("div");
    this.el.className = "sc-lapse";
    this.el.setAttribute("role", "status");

    this.msg = doc.createElement("span");
    this.msg.className = "sc-lapse-msg";
    this.msg.textContent = "Review session paused after inactivity.";

    this.btn = doc.createElement("button");
    this.btn.type = "button";
    this.btn.className = "sc-lapse-btn";
    this.btn.textContent = "Renew session";
    this.btn.addEventListener("click", () => void this.handleRenew());

    this.el.append(this.msg, this.btn);
    parent.appendChild(this.el);
    fadeIn(this.el);
  }

  private async handleRenew(): Promise<void> {
    this.btn.disabled = true;
    this.btn.textContent = "Renewing";
    // The controller destroys this panel on success; on failure it calls showError.
    await this.callbacks.onRenew();
  }

  /** Show a terminal error (e.g. the link was revoked) and re-enable retry. */
  showError(text: string): void {
    if (this.destroyed) return;
    this.msg.textContent = text;
    this.btn.disabled = false;
    this.btn.textContent = "Try again";
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.el.remove();
  }
}
