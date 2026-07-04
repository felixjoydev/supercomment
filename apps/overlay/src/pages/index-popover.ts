/**
 * Page-index popover (U12): a card anchored above the toolbar listing the pages a
 * preview has comments on, each with a comment count, an unread red dot, and the
 * current page highlighted. Clicking a page navigates same-origin to it. Reload-on-
 * open (the controller passes a fresh entry list each time), so it is a snapshot.
 *
 * VERIFY IN REAL ENV: the visual placement + same-origin navigation cannot be
 * exercised in this sandbox; the entry model (groupPagesForIndex) is unit-tested.
 */
import { fadeIn, exitCard } from "../shell/motion.js";
import type { PageEntry } from "./page-index.js";

export interface PageIndexPopoverCallbacks {
  /** Navigate to a page's path (same-origin). */
  onOpenPage(path: string): void;
  onClose(): void;
}

export class PageIndexPopover {
  private readonly doc: Document;
  private readonly backdrop: HTMLElement;
  private readonly onKeydown: (e: Event) => void;
  private destroyed = false;

  constructor(
    doc: Document,
    parent: HTMLElement,
    entries: PageEntry[],
    callbacks: PageIndexPopoverCallbacks,
  ) {
    this.doc = doc;

    this.backdrop = doc.createElement("div");
    this.backdrop.className = "sc-pages-backdrop";
    this.backdrop.addEventListener("click", (e) => {
      if (e.target === this.backdrop) callbacks.onClose();
    });

    const card = doc.createElement("div");
    card.className = "sc-pages";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-label", "Pages with comments");

    const head = doc.createElement("div");
    head.className = "sc-pages-head";
    head.textContent = "Pages";
    card.appendChild(head);

    if (entries.length === 0) {
      const empty = doc.createElement("div");
      empty.className = "sc-pages-empty";
      empty.textContent = "No comments yet.";
      card.appendChild(empty);
    } else {
      const list = doc.createElement("div");
      list.className = "sc-pages-list";
      for (const entry of entries) {
        list.appendChild(this.buildRow(entry, callbacks));
      }
      card.appendChild(list);
    }

    this.backdrop.appendChild(card);
    parent.appendChild(this.backdrop);
    fadeIn(this.backdrop);

    this.onKeydown = (e) => {
      if ((e as KeyboardEvent).key === "Escape") callbacks.onClose();
    };
    doc.addEventListener("keydown", this.onKeydown);
  }

  private buildRow(
    entry: PageEntry,
    callbacks: PageIndexPopoverCallbacks,
  ): HTMLElement {
    const navigable = entry.path !== null;
    const row = this.doc.createElement(navigable ? "button" : "div");
    row.className = "sc-pages-row" + (entry.isCurrent ? " is-current" : "");
    if (navigable) {
      (row as HTMLButtonElement).type = "button";
      row.title = `Open ${entry.label}`;
      row.addEventListener("click", () => callbacks.onOpenPage(entry.path as string));
    }

    if (entry.hasUnread) {
      const dot = this.doc.createElement("span");
      dot.className = "sc-pages-dot";
      dot.title = `${entry.unreadCount} unread`;
      dot.setAttribute("aria-label", `${entry.unreadCount} unread`);
      row.appendChild(dot);
    }

    const label = this.doc.createElement("span");
    label.className = "sc-pages-label";
    label.textContent = entry.isCurrent ? `${entry.label} (current)` : entry.label;
    row.appendChild(label);

    const count = this.doc.createElement("span");
    count.className = "sc-pages-count";
    count.textContent = String(entry.count);
    row.appendChild(count);

    return row;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.doc.removeEventListener("keydown", this.onKeydown);
    const done = exitCard(this.backdrop);
    if (done) void done.then(() => this.backdrop.remove());
    else this.backdrop.remove();
  }
}
