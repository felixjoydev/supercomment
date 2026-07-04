/**
 * Marker rendering into the shadow layer.
 *
 * Takes the placed markers, clusters the visible ones into pins/badges and
 * draws edge indicators for off-screen ones, then paints them into a dedicated
 * container. Pure clustering math lives in `cluster.ts`; this file only renders
 * the results, so it stays thin.
 *
 * Pins are clickable (R12): clicking one opens a popover card with the comment
 * content so a reviewer can READ the thread on the live deploy, not just see
 * numbered pins.
 */
import type { MarkerComment, Rect } from "../core/types.js";
import {
  clusterMarkers,
  partitionByViewport,
  DEFAULT_CLUSTER_THRESHOLD_PX,
  type MarkerInput,
} from "./cluster.js";
import { edgeDirection } from "../core/geometry.js";
import { popIn } from "../shell/motion.js";
import type { ReplyRow, ThreadClient } from "../submit/thread.js";

/** Comment-popover sizing (CSS px). Mirrors `.sc-comment-pop` in styles.ts. */
const POPOVER_WIDTH = 280;
const POPOVER_MARGIN = 12;
/** Rough height used for edge-aware placement before the card is measured. */
const POPOVER_EST_HEIGHT = 132;

/** A placed comment marker, anchored to its target rect (DOCUMENT space, i.e.
 * viewport rect + scroll offset). The renderer subtracts the current scroll on
 * every paint so the pin tracks its element as the page scrolls. */
export interface PlacedMarker {
  number: number;
  rect: Rect;
  /**
   * U12: an EXISTING comment whose element could not be confidently re-anchored
   * on the current deploy is rendered in a visually distinct stale state (kept
   * visible). Fresh submits leave this undefined. U8 flips it from anchor
   * corroboration; for now it reflects the server-persisted is_stale flag.
   */
  isStale?: boolean;
  /**
   * U12: the human-readable comment shown in the popover when this pin is
   * clicked. Optional so non-read callers (and older tests) can place a bare
   * numbered pin; when absent the popover shows just the number.
   */
  content?: MarkerComment;
}

export class MarkerLayer {
  private readonly container: HTMLElement;
  private readonly markers: PlacedMarker[] = [];
  /** Number of the marker added by the latest add(), so only IT pops in —
   * scroll/resize repaints must not replay entrance animations. */
  private justAdded: number | null = null;

  /** The open comment popover (lives on `parent`, NOT `container`, so the
   * scroll/resize repaint's `replaceChildren()` cannot destroy it). */
  private popover: HTMLElement | null = null;
  /** The comment numbers the open popover represents (the clicked cluster). */
  private popoverNumbers: number[] | null = null;

  constructor(
    private readonly doc: Document,
    private readonly parent: HTMLElement,
    private readonly thresholdPx: number = DEFAULT_CLUSTER_THRESHOLD_PX,
    /** Reply / resolve / delete client (0033); absent → read-only popover. */
    private readonly thread?: ThreadClient,
    /** The current reviewer, for own-reply delete + member-only thread delete. */
    private readonly currentUser?: { displayName: string; role: string },
  ) {
    this.container = doc.createElement("div");
    this.container.className = "sc-marker-container";
    this.parent.appendChild(this.container);

    // ONE delegated click listener: pins are re-created on every repaint
    // (`container.replaceChildren()`), so a per-pin listener would be lost each
    // paint. The container survives, and clicks on its pins bubble up to it.
    this.container.addEventListener("click", (e) => this.handlePinClick(e));
  }

  /** Register a new marker and repaint (the new pin pops in once). */
  add(marker: PlacedMarker): void {
    this.markers.push(marker);
    this.justAdded = marker.number;
    this.render();
    this.justAdded = null;
  }

  /**
   * U12: register MANY existing comments at once (loaded back on activate) and
   * repaint once. Unlike add(), these do NOT pop in — they are pre-existing, not
   * freshly created — and any marked stale renders in a distinct state.
   */
  addMany(markers: PlacedMarker[]): void {
    if (markers.length === 0) return;
    this.markers.push(...markers);
    this.justAdded = null;
    this.render();
  }

  /** Current marker count (for tests / debugging). */
  count(): number {
    return this.markers.length;
  }

  /** Re-paint all markers against the current viewport. */
  render(viewport?: { width: number; height: number }): void {
    const vp = viewport ?? this.viewport();
    this.container.replaceChildren();

    // Markers are stored in DOCUMENT space; convert to VIEWPORT space against the
    // CURRENT scroll so pins track their element as the page scrolls (not stuck to
    // a stale on-screen position). A marker with no real box is dropped rather than
    // piled at the (0,0) corner.
    const { x: sx, y: sy } = this.scroll();
    const inputs: MarkerInput[] = this.markers
      .map((m) => ({
        number: m.number,
        rect: {
          x: m.rect.x - sx,
          y: m.rect.y - sy,
          width: m.rect.width,
          height: m.rect.height,
        },
      }))
      .filter((m) => isPlaceable(m.rect));

    const { visible, offscreen } = partitionByViewport(inputs, vp);

    // U12: numbers rendered in the distinct stale state (kept visible).
    const staleNumbers = new Set<number>(
      this.markers.filter((m) => m.isStale).map((m) => m.number),
    );
    // U16 (R11): numbers whose comment is a visual-edit `template` — a distinct
    // marker treatment so templates read differently from ordinary comments.
    const templateNumbers = new Set<number>(
      this.markers
        .filter((m) => m.content?.kind === "template")
        .map((m) => m.number),
    );
    // A resolved (marked-done) comment dims its pin.
    const resolvedNumbers = new Set<number>(
      this.markers
        .filter((m) => m.content?.status === "resolved")
        .map((m) => m.number),
    );

    const clusters = clusterMarkers(visible, this.thresholdPx);
    for (const cluster of clusters) {
      const el = this.doc.createElement("div");
      if (cluster.isCluster) {
        el.className = "sc-marker sc-cluster";
      } else {
        // A single pin can be BOTH a template and stale — compose the classes so
        // a stale visual-edit template keeps its distinct treatment (R11) rather
        // than collapsing to the plain stale pin.
        const n = cluster.numbers[0]!;
        let cls = "sc-marker";
        if (templateNumbers.has(n)) cls += " sc-template";
        if (staleNumbers.has(n)) cls += " sc-stale";
        if (resolvedNumbers.has(n)) cls += " sc-resolved";
        el.className = cls;
      }
      el.style.left = `${cluster.point.x}px`;
      el.style.top = `${cluster.point.y}px`;
      el.textContent = cluster.isCluster
        ? String(cluster.numbers.length)
        : String(cluster.numbers[0]);
      el.setAttribute(
        "data-numbers",
        cluster.numbers.join(","),
      );
      this.container.appendChild(el);
      if (this.justAdded !== null && cluster.numbers.includes(this.justAdded)) {
        popIn(el);
      }
    }

    for (const off of offscreen) {
      const el = this.doc.createElement("div");
      el.className = staleNumbers.has(off.number) ? "sc-edge sc-stale" : "sc-edge";
      el.setAttribute("data-direction", edgeDirection(off.point, vp));
      el.setAttribute("data-number", String(off.number));
      // Pin the indicator to the nearest viewport edge along the direction.
      const clampedX = Math.max(8, Math.min(vp.width - 30, off.point.x));
      const clampedY = Math.max(8, Math.min(vp.height - 30, off.point.y));
      el.style.left = `${clampedX}px`;
      el.style.top = `${clampedY}px`;
      el.textContent = String(off.number);
      this.container.appendChild(el);
    }

    // Keep an open popover anchored to its cluster across scroll/resize. If the
    // pin re-clustered or scrolled off-screen there is no matching visible
    // cluster, so close the popover rather than leave it floating.
    if (this.popover && this.popoverNumbers) {
      const match = clusters.find((c) =>
        sameNumberSet(c.numbers, this.popoverNumbers!),
      );
      if (match) this.positionPopover(match.point);
      else this.closePopover();
    }
  }

  /** Number of currently-rendered pins/badges (clusters count once). */
  renderedPinCount(): number {
    return this.container.querySelectorAll(".sc-marker").length;
  }

  /** Number of currently-rendered off-screen edge indicators. */
  renderedEdgeCount(): number {
    return this.container.querySelectorAll(".sc-edge").length;
  }

  /** True when a comment popover is currently open (for tests / debugging). */
  hasOpenPopover(): boolean {
    return this.popover !== null;
  }

  // --- Comment popover ----------------------------------------------------

  /** Toggle the popover for whichever pin/cluster was clicked. */
  private handlePinClick(e: Event): void {
    const target = e.target as Element | null;
    const pin = target?.closest?.(".sc-marker") as HTMLElement | null;
    if (!pin) return;
    const numbers = parseNumbers(pin.getAttribute("data-numbers"));
    if (numbers.length === 0) return;

    // Clicking the already-open pin closes it; a different pin switches content.
    if (this.popover && sameNumberSet(numbers, this.popoverNumbers ?? [])) {
      this.closePopover();
      return;
    }
    this.showPopover(numbers, {
      x: parseFloat(pin.style.left) || 0,
      y: parseFloat(pin.style.top) || 0,
    });
  }

  /**
   * Open a popover card listing every marker whose number is in `numbers`
   * (cluster → multiple entries). Appended to the PARENT layer so a scroll
   * repaint's `container.replaceChildren()` cannot destroy it.
   */
  showPopover(numbers: number[], anchorPoint: { x: number; y: number }): void {
    this.closePopover();

    const pop = this.doc.createElement("div");
    pop.className = "sc-comment-pop";
    pop.setAttribute("role", "dialog");
    pop.setAttribute("aria-label", "Comment");

    const wanted = new Set(numbers);
    const entries = this.markers.filter((mk) => wanted.has(mk.number));

    // A titled header bar (like a comment tool's card): "Comment(s)" + close.
    pop.appendChild(this.buildPopHeader(entries.length));

    for (const m of entries) pop.appendChild(this.buildEntry(m));

    this.parent.appendChild(pop);
    this.popover = pop;
    this.popoverNumbers = numbers.slice();
    this.positionPopover(anchorPoint);
  }

  /** Public close — remove the popover element and clear refs. */
  closePopover(): void {
    this.popover?.remove();
    this.popover = null;
    this.popoverNumbers = null;
  }

  /** The popover's top bar: a "Comment(s)" title on the left, close on the right. */
  private buildPopHeader(count: number): HTMLElement {
    const header = this.doc.createElement("div");
    header.className = "sc-pop-header";

    const title = this.doc.createElement("div");
    title.className = "sc-pop-title";
    title.textContent = count > 1 ? "Comments" : "Comment";
    header.appendChild(title);

    const close = this.doc.createElement("button");
    close.type = "button";
    close.className = "sc-pop-close";
    close.setAttribute("aria-label", "Close");
    close.title = "Close";
    close.textContent = "×"; // ×
    close.addEventListener("click", () => this.closePopover());
    header.appendChild(close);

    return header;
  }

  /** A round avatar: the name's first letter on a color hashed from the name. */
  private buildAvatar(name: string, size: "sm" | "md" = "md"): HTMLElement {
    const av = this.doc.createElement("div");
    av.className = size === "sm" ? "sc-avatar sc-avatar-sm" : "sc-avatar";
    av.textContent = (name.trim()[0] || "?").toUpperCase();
    av.style.background = avatarColor(name);
    av.setAttribute("aria-hidden", "true");
    return av;
  }

  /**
   * Build one thread: the root comment (avatar + author + "#N · time", note),
   * its replies, a reply box, and the mark-done / delete actions. When no thread
   * client is wired (tunnel / tests) it degrades to the read-only card.
   */
  private buildEntry(m: PlacedMarker): HTMLElement {
    const entry = this.doc.createElement("div");
    entry.className = "sc-comment-entry";
    const commentId = m.content?.id;
    const interactive = !!(this.thread && commentId);
    if (m.content?.status === "resolved") entry.classList.add("is-resolved");

    const head = this.doc.createElement("div");
    head.className = "sc-comment-head";

    const author = m.content?.authorDisplayName || "Guest";
    head.appendChild(this.buildAvatar(author));

    const byline = this.doc.createElement("div");
    byline.className = "sc-comment-byline";
    const who = this.doc.createElement("div");
    who.className = "sc-comment-author";
    who.textContent = author;
    byline.appendChild(who);
    const sub = this.doc.createElement("div");
    sub.className = "sc-comment-sub";
    const when = shortTime(m.content?.createdAt);
    sub.textContent = when ? `#${m.number} · ${when}` : `#${m.number}`; // ·
    byline.appendChild(sub);
    head.appendChild(byline);

    if (interactive) head.appendChild(this.buildActions(m, entry));
    entry.appendChild(head);

    // U16 (R11): mark a visual-edit template distinctly in the popover.
    if (m.content?.kind === "template") {
      const tag = this.doc.createElement("div");
      tag.className = "sc-comment-tag";
      tag.textContent = "Template · visual edit";
      entry.appendChild(tag);
    }

    const noteText = m.content?.note ?? "";
    if (noteText) {
      const note = this.doc.createElement("div");
      note.className = "sc-comment-note";
      note.textContent = noteText;
      entry.appendChild(note);
    }

    if (interactive) {
      const replies = this.doc.createElement("div");
      replies.className = "sc-reply-list";
      entry.appendChild(replies);
      void this.loadReplies(commentId!, replies);
      entry.appendChild(this.buildReplyBox(commentId!, replies));
    }

    return entry;
  }

  /** Mark-done toggle + the members-only "..." menu (delete thread). */
  private buildActions(m: PlacedMarker, entry: HTMLElement): HTMLElement {
    const commentId = m.content!.id!;
    const actions = this.doc.createElement("div");
    actions.className = "sc-comment-actions";

    const done = this.doc.createElement("button");
    done.type = "button";
    done.className = "sc-act sc-act-done";
    const setDoneUi = () => {
      const on = m.content?.status === "resolved";
      done.classList.toggle("is-on", on);
      done.title = on ? "Reopen" : "Mark as done";
      done.setAttribute("aria-label", done.title);
    };
    done.textContent = "✓";
    setDoneUi();
    done.addEventListener("click", async () => {
      const want = m.content?.status !== "resolved";
      done.disabled = true;
      const ok = await this.thread!.resolve(commentId, want);
      done.disabled = false;
      if (ok) {
        if (m.content) m.content.status = want ? "resolved" : "open";
        entry.classList.toggle("is-resolved", want);
        setDoneUi();
        this.render(); // dim / undim the pin
      } else {
        this.flash(entry, "Could not update. Try again.");
      }
    });
    actions.appendChild(done);

    // Delete a whole thread is owner-only; only members can be the owner, so the
    // action is hidden from guests entirely (a client can never wipe a thread).
    if (this.currentUser?.role === "member") {
      actions.appendChild(this.buildThreadMenu(m, entry));
    }
    return actions;
  }

  /** The "..." menu with a two-click "Delete thread" confirm (owner-gated by RPC). */
  private buildThreadMenu(m: PlacedMarker, entry: HTMLElement): HTMLElement {
    const commentId = m.content!.id!;
    const wrap = this.doc.createElement("div");
    wrap.className = "sc-act-more-wrap";
    const btn = this.doc.createElement("button");
    btn.type = "button";
    btn.className = "sc-act sc-act-more";
    btn.textContent = "···";
    btn.title = "More";
    btn.setAttribute("aria-label", "More actions");
    const menu = this.doc.createElement("div");
    menu.className = "sc-act-menu";
    menu.hidden = true;
    const del = this.doc.createElement("button");
    del.type = "button";
    del.className = "sc-act-menu-item is-danger";
    del.textContent = "Delete thread";
    let armed = false;
    del.addEventListener("click", async () => {
      if (!armed) {
        armed = true;
        del.textContent = "Click again to delete";
        return;
      }
      del.disabled = true;
      const ok = await this.thread!.deleteThread(commentId);
      if (ok) {
        this.removeMarker(m.number);
        this.closePopover();
      } else {
        del.disabled = false;
        armed = false;
        del.textContent = "Delete thread";
        menu.hidden = true;
        this.flash(entry, "Only the workspace owner can delete a thread.");
      }
    });
    menu.appendChild(del);
    btn.addEventListener("click", () => {
      menu.hidden = !menu.hidden;
      if (menu.hidden) {
        armed = false;
        del.textContent = "Delete thread";
      }
    });
    wrap.appendChild(btn);
    wrap.appendChild(menu);
    return wrap;
  }

  /** Load and render the thread's replies into `container` (best-effort). */
  private async loadReplies(commentId: string, container: HTMLElement): Promise<void> {
    const replies = await this.thread!.listReplies(commentId);
    // The popover may have closed/re-opened while loading; only fill if still live.
    if (!container.isConnected) return;
    container.replaceChildren();
    for (const r of replies) container.appendChild(this.buildReplyElement(r, container));
  }

  /** One reply row: author · time, body, and a delete for the reviewer's own reply. */
  private buildReplyElement(r: ReplyRow, container: HTMLElement): HTMLElement {
    const el = this.doc.createElement("div");
    el.className = "sc-reply";
    el.appendChild(this.buildAvatar(r.author_display_name, "sm"));
    const main = this.doc.createElement("div");
    main.className = "sc-reply-main";
    const head = this.doc.createElement("div");
    head.className = "sc-reply-head";
    const who = this.doc.createElement("span");
    who.className = "sc-reply-author";
    who.textContent = r.author_display_name;
    head.appendChild(who);
    const when = shortTime(r.created_at);
    if (when) {
      const t = this.doc.createElement("span");
      t.className = "sc-reply-time";
      t.textContent = ` · ${when}`;
      head.appendChild(t);
    }
    // Own reply -> deletable. Matched on name + trust (the RPC still enforces it).
    const mine =
      !!this.currentUser &&
      r.author_display_name === this.currentUser.displayName &&
      r.trust_level === this.currentUser.role;
    if (mine) {
      const del = this.doc.createElement("button");
      del.type = "button";
      del.className = "sc-reply-del";
      del.textContent = "×";
      del.title = "Delete reply";
      del.setAttribute("aria-label", "Delete reply");
      del.addEventListener("click", async () => {
        del.disabled = true;
        const ok = await this.thread!.deleteReply(r.id);
        if (ok) el.remove();
        else {
          del.disabled = false;
          this.flash(container, "Could not delete. Try again.");
        }
      });
      head.appendChild(del);
    }
    main.appendChild(head);
    const body = this.doc.createElement("div");
    body.className = "sc-reply-body";
    body.textContent = r.body;
    main.appendChild(body);
    el.appendChild(main);
    return el;
  }

  /** The reply input + send button; posts via the thread client and appends. */
  private buildReplyBox(commentId: string, list: HTMLElement): HTMLElement {
    const box = this.doc.createElement("div");
    box.className = "sc-reply-box";
    box.appendChild(this.buildAvatar(this.currentUser?.displayName ?? "", "sm"));
    const input = this.doc.createElement("textarea");
    input.className = "sc-reply-input";
    input.rows = 1;
    input.placeholder = "Reply";
    input.setAttribute("aria-label", "Reply");
    const send = this.doc.createElement("button");
    send.type = "button";
    send.className = "sc-reply-send";
    send.textContent = "↑"; // ↑ send arrow
    send.title = "Send reply";
    send.setAttribute("aria-label", "Send reply");
    const submit = async () => {
      const body = input.value.trim();
      if (!body) return;
      send.disabled = true;
      input.disabled = true;
      const reply = await this.thread!.createReply(commentId, body);
      send.disabled = false;
      input.disabled = false;
      if (reply) {
        list.appendChild(this.buildReplyElement(reply, list));
        input.value = "";
        input.focus();
      } else {
        this.flash(box, "Could not send. Try again.");
      }
    };
    send.addEventListener("click", () => void submit());
    // Enter sends; Shift+Enter is a newline.
    input.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void submit();
      }
    });
    box.appendChild(input);
    box.appendChild(send);
    return box;
  }

  /** Remove a marker entirely (after its thread is deleted) and repaint. */
  removeMarker(number: number): void {
    const i = this.markers.findIndex((m) => m.number === number);
    if (i >= 0) this.markers.splice(i, 1);
    this.render();
  }

  /** Flash a transient message inside the popover (no native dialogs). */
  private flash(host: HTMLElement, message: string): void {
    const el = this.doc.createElement("div");
    el.className = "sc-comment-flash";
    el.textContent = message;
    host.appendChild(el);
    const view = this.doc.defaultView;
    view?.setTimeout(() => el.remove(), 2600);
  }

  /** Place the popover near `anchor` (a pin center), clamped to the viewport. */
  private positionPopover(anchor: { x: number; y: number }): void {
    if (!this.popover) return;
    const vp = this.viewport();

    // Prefer just below-right of the pin; flip left/up when it would overflow.
    let left = anchor.x + 16;
    if (left + POPOVER_WIDTH + POPOVER_MARGIN > vp.width) {
      left = anchor.x - POPOVER_WIDTH - 16;
    }
    left = Math.max(
      POPOVER_MARGIN,
      Math.min(left, vp.width - POPOVER_WIDTH - POPOVER_MARGIN),
    );

    let top = anchor.y + 16;
    if (top + POPOVER_EST_HEIGHT + POPOVER_MARGIN > vp.height) {
      top = anchor.y - POPOVER_EST_HEIGHT - 16;
    }
    top = Math.max(POPOVER_MARGIN, top);

    this.popover.style.left = `${left}px`;
    this.popover.style.top = `${top}px`;
  }

  private viewport(): { width: number; height: number } {
    const w =
      (this.doc.defaultView && this.doc.defaultView.innerWidth) ||
      this.doc.documentElement.clientWidth ||
      1024;
    const h =
      (this.doc.defaultView && this.doc.defaultView.innerHeight) ||
      this.doc.documentElement.clientHeight ||
      768;
    return { width: w, height: h };
  }

  /** Current document scroll offset (0 in non-browser envs / tests). */
  private scroll(): { x: number; y: number } {
    const view = this.doc.defaultView;
    return {
      x: view?.scrollX ?? view?.pageXOffset ?? 0,
      y: view?.scrollY ?? view?.pageYOffset ?? 0,
    };
  }
}

/**
 * Whether a VIEWPORT-space marker rect can be drawn. A zero-size rect sitting at
 * the viewport origin is the "unplaced" marker that piled at the top-left corner
 * (a degenerate box that resolved to 0,0), so it is dropped. A zero-size rect
 * anywhere else is a legitimate point anchor and is kept.
 */
function isPlaceable(rect: Rect): boolean {
  const hasSize = rect.width >= 1 || rect.height >= 1;
  const atOrigin = Math.abs(rect.x) < 1 && Math.abs(rect.y) < 1;
  return hasSize || !atOrigin;
}

/** Parse a `data-numbers` comma list ("1,2,3") into numbers. */
function parseNumbers(raw: string | null): number[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n));
}

/** True when two number lists hold the same set (order-independent). */
function sameNumberSet(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(b);
  return a.every((n) => set.has(n));
}

/** Compact relative time ("just now", "5m ago", …) for a comment's createdAt. */
function shortTime(iso?: string): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const sec = Math.round((Date.now() - t) / 1000);
  if (sec < 45) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(t).toLocaleDateString();
}

/** A small, pleasant palette for name-hashed avatars (white text reads on each). */
const AVATAR_COLORS = [
  "#2f9e6f",
  "#3b82c4",
  "#8b5cf6",
  "#d9822b",
  "#c0398b",
  "#0d9488",
  "#6366f1",
  "#db5461",
];

/** Deterministic avatar color from a name (stable across renders; no RNG). */
function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length]!;
}
