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
import {
  commentModifyGate,
  isValidCaptureImage,
  modifyLockLabel,
  resolveCaptureSrc,
} from "@supercomment/shared";

import type {
  LaneClient,
  MarkerComment,
  Rect,
  ScreenshotUploader,
} from "../core/types.js";
import type { CommentLane } from "@supercomment/shared";
import { displayLaneOf, laneLabelFor, audienceOf } from "../core/lane.js";
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
    /**
     * Out-of-band image uploader (0027/U13 seam) for reply-image attachments
     * (R19). Absent (tunnel/tests) → the reply composer shows no attach control.
     */
    private readonly uploader?: ScreenshotUploader,
    /**
     * U11: moves a comment between lanes from its popover (member sessions).
     * Absent (guest / tunnel / tests) → no lane control is rendered.
     */
    private readonly laneClient?: LaneClient,
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
   *
   * Idempotent by comment number: a number already placed is skipped, so the
   * mount-time load and the live sync poll (or a device-mode re-hand-off) can
   * never stack two pins for the same comment if they race.
   */
  addMany(markers: PlacedMarker[]): void {
    const fresh = markers.filter((m) => !this.hasNumber(m.number));
    if (fresh.length === 0) return;
    this.markers.push(...fresh);
    this.justAdded = null;
    this.render();
  }

  /** Current marker count (for tests / debugging). */
  count(): number {
    return this.markers.length;
  }

  /** Whether a marker with this comment number is already placed. Lets the live
   * comment sync skip re-adding a pin the reviewer already sees (e.g. their own
   * just-submitted optimistic pin the server read now echoes back). */
  hasNumber(number: number): boolean {
    return this.markers.some((m) => m.number === number);
  }

  /**
   * Replace a placed marker's content (and stale-ness) after a live re-read, and
   * repaint so status-driven treatments update in place — e.g. a comment marked
   * done by someone else dims its pin, an edited note refreshes the popover — all
   * without re-anchoring or a full clear/repaint. No-op if the number isn't placed.
   */
  updateContent(number: number, content: MarkerComment, isStale?: boolean): void {
    const m = this.markers.find((mk) => mk.number === number);
    if (!m) return;
    m.content = content;
    if (isStale !== undefined) m.isStale = isStale;
    this.render();
  }

  /** Hide/show every pin (used while the review session is lapsed). */
  setHidden(hidden: boolean): void {
    this.container.style.display = hidden ? "none" : "";
    if (hidden) this.closePopover();
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
    // U10: an OPEN comment's workflow lane, for a lane-tinted pin (a resolved /
    // dismissed pin already has its own treatment, so it gets no lane class).
    const laneByNumber = new Map<number, string>();
    for (const m of this.markers) {
      const status = m.content?.status;
      if (status === "resolved" || status === "dismissed") continue;
      laneByNumber.set(m.number, m.content?.lane ?? "backlog");
    }

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
        const lane = laneByNumber.get(n);
        if (lane) cls += ` sc-lane-${lane}`;
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

    // U10/U11: the workflow lane. A MEMBER on an OPEN comment gets an
    // interactive lane control (move between lanes); everyone else gets the
    // read-only, audience-aware lane chip (a reviewer never sees the internal
    // pipeline names — Open / In progress / Ready for review / Done).
    const isMember = this.currentUser?.role === "member";
    const isOpen = (m.content?.status ?? "open") === "open";
    if (isMember && isOpen && this.laneClient && m.content?.id) {
      entry.appendChild(this.buildLaneControl(m, entry));
    } else {
      const lane = displayLaneOf(m.content);
      const laneChip = this.doc.createElement("div");
      laneChip.className = `sc-comment-lane sc-lane-${lane}`;
      laneChip.textContent = laneLabelFor(lane, audienceOf(this.currentUser?.role));
      entry.appendChild(laneChip);
    }

    const noteText = m.content?.note ?? "";
    if (noteText) {
      const note = this.doc.createElement("div");
      note.className = "sc-comment-note";
      note.textContent = noteText;
      entry.appendChild(note);
    }

    // Reviewer reference images ("what I want", R19) — signed + shown so a
    // reviewer SEES the attached reference on the live deploy, not just its note.
    // Needs the thread client's signer; without one (tunnel/tests) there is no
    // way to sign a private path, so the block is skipped rather than empty.
    const refImages = m.content?.referenceImages;
    if (refImages && refImages.length > 0 && this.thread) {
      entry.appendChild(this.buildReferenceGallery(refImages));
    }

    if (interactive) {
      const replies = this.doc.createElement("div");
      replies.className = "sc-reply-list";
      // Tag the list with its thread id so a live reply refresh (0040) can reload
      // just this list in place, without rebuilding the popover or the draft box.
      replies.setAttribute("data-comment-id", commentId!);
      entry.appendChild(replies);
      void this.loadReplies(commentId!, replies);
      entry.appendChild(this.buildReplyBox(commentId!, replies));
    }

    return entry;
  }

  /**
   * A captioned row of the reviewer's reference-image thumbnails (R19), shown in
   * the popover under the note. Signs each `captures` path via the thread
   * client's `signCapture` and fills slots asynchronously; a failed sign drops
   * its slot, so a broken reference is silently omitted (never a broken <img>).
   */
  private buildReferenceGallery(refs: string[]): HTMLElement {
    const gallery = this.doc.createElement("div");
    gallery.className = "sc-ref-gallery";
    const cap = this.doc.createElement("div");
    cap.className = "sc-ref-gallery-cap";
    cap.textContent =
      refs.length > 1
        ? `Reference · what I want · ${refs.length}`
        : "Reference · what I want";
    const grid = this.doc.createElement("div");
    grid.className = "sc-ref-gallery-grid";
    gallery.append(cap, grid);
    void this.fillCaptureThumbs(refs, grid);
    return gallery;
  }

  /**
   * Sign each `captures` ref (in stored order) and fill/remove its slot in
   * `grid` — the shared primitive behind both reference-image and reply-image
   * thumbnails. Best-effort: with no thread client (tunnel/tests) there is no
   * signer, so nothing renders; an individual failed sign drops only its slot.
   * `resolveCaptureSrc` also passes an inline `data:image/*` value through.
   */
  private async fillCaptureThumbs(refs: string[], grid: HTMLElement): Promise<void> {
    const thread = this.thread;
    if (!thread) return;
    const signer = (_bucket: string, path: string) => thread.signCapture(path);
    // One ordered slot per ref so signs completing out of order keep position.
    const slots = refs.map(() => {
      const slot = this.doc.createElement("button");
      slot.type = "button";
      slot.className = "sc-shot is-loading";
      slot.setAttribute("aria-label", "Open image");
      grid.appendChild(slot);
      return slot;
    });
    await Promise.all(
      refs.map(async (ref, i) => {
        const slot = slots[i]!;
        const url = await resolveCaptureSrc(ref, signer);
        if (!url) {
          slot.remove();
          return;
        }
        const img = this.doc.createElement("img") as HTMLImageElement;
        img.src = url;
        img.alt = "Attached image";
        slot.classList.remove("is-loading");
        slot.appendChild(img);
        slot.addEventListener("click", () => this.openLightbox(url));
      }),
    );
  }

  /** Full-viewport image lightbox; dismiss on backdrop click or Escape. */
  private openLightbox(url: string): void {
    const box = this.doc.createElement("div");
    box.className = "sc-lightbox";
    const img = this.doc.createElement("img") as HTMLImageElement;
    img.src = url;
    img.alt = "Attached image";
    img.addEventListener("click", (e) => e.stopPropagation());
    box.appendChild(img);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const close = () => {
      box.remove();
      this.doc.removeEventListener("keydown", onKey);
    };
    box.addEventListener("click", () => close());
    this.doc.addEventListener("keydown", onKey);
    this.parent.appendChild(box);
  }

  /**
   * Re-fetch replies for every thread in the OPEN popover — a reply arrived live
   * (broadcast) while the reviewer has the pin open. Only each `.sc-reply-list`'s
   * contents are replaced (loadReplies does `replaceChildren`), so the popover,
   * the reply-input box, and any half-typed draft survive. No-op when nothing is
   * open or no thread client is wired.
   */
  refreshOpenReplies(): void {
    if (!this.popover || !this.thread) return;
    const lists = this.popover.querySelectorAll(".sc-reply-list");
    for (const list of Array.from(lists as ArrayLike<Element>)) {
      const id = (list as HTMLElement).getAttribute("data-comment-id");
      if (id) void this.loadReplies(id, list as HTMLElement);
    }
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

    // Manage menu: author edit/delete (gated), owner delete override, or a
    // locked-reason hint. Null when there is nothing to offer.
    const menu = this.buildManageMenu(m, entry);
    if (menu) actions.appendChild(menu);
    return actions;
  }

  /**
   * U11: the member lane control in a comment's popover — chips to move an OPEN
   * comment between the three open lanes (the click/keyboard way to move a lane
   * from the live page; Done/Reopen stay the ✓ toggle). Optimistic with
   * rollback: the chip + pin re-tint immediately and snap back with a flash if
   * set_comment_lane fails. "Ready for agent" carries the guest-confirm (the
   * SessionLaneClient passes p_confirm_guest: true — the deliberate click).
   */
  private buildLaneControl(m: PlacedMarker, entry: HTMLElement): HTMLElement {
    const commentId = m.content!.id!;
    const openLanes: CommentLane[] = ["backlog", "ready_for_agent", "in_review"];
    const wrap = this.doc.createElement("div");
    wrap.className = "sc-comment-lanes";

    const paint = () => {
      wrap.replaceChildren();
      const label = this.doc.createElement("span");
      label.className = "sc-comment-lanes-label";
      label.textContent = "Lane";
      wrap.appendChild(label);
      for (const lane of openLanes) {
        const current = (m.content?.lane ?? "backlog") === lane;
        const chip = this.doc.createElement("button");
        chip.type = "button";
        chip.className = current ? "sc-lane-chip is-current" : "sc-lane-chip";
        chip.textContent = laneLabelFor(lane, "member");
        chip.disabled = current;
        chip.setAttribute("aria-pressed", String(current));
        chip.addEventListener("click", async () => {
          const prev = m.content?.lane ?? "backlog";
          if (m.content) m.content.lane = lane; // optimistic
          paint();
          this.render(); // re-tint the pin
          const ok = await this.laneClient!.setLane(commentId, lane);
          if (!ok) {
            if (m.content) m.content.lane = prev; // rollback
            paint();
            this.render();
            this.flash(entry, "Could not move. Try again.");
          }
        });
        wrap.appendChild(chip);
      }
    };

    paint();
    return wrap;
  }

  /**
   * The "···" manage menu (0050): the AUTHOR's Edit + Delete while their comment
   * is untouched by others (commentModifyGate), a member's owner-delete override
   * (RPC-enforced), or a short locked-reason hint for a guest author whose
   * comment is frozen. Returns null when there is nothing to offer.
   */
  private buildManageMenu(
    m: PlacedMarker,
    entry: HTMLElement,
  ): HTMLElement | null {
    const commentId = m.content?.id;
    if (!commentId) return null;
    const gate = commentModifyGate({
      isOwn: !!m.content?.isOwn,
      status: m.content?.status ?? "open",
      hasReplies: !!m.content?.hasReplies,
      isSent: !!m.content?.isSent,
    });
    const isMember = this.currentUser?.role === "member";
    const showEdit = gate.canModify;
    // Author-untouched delete, OR a member's owner override (the RPC enforces
    // owner-or-author-untouched; a non-owner member's attempt fails with a flash).
    const showDelete = gate.canModify || isMember;
    // A guest author whose comment is frozen: explain rather than silently hide.
    const showLock = !!m.content?.isOwn && !gate.canModify && !isMember;
    if (!showEdit && !showDelete && !showLock) return null;

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

    if (showEdit) {
      const edit = this.doc.createElement("button");
      edit.type = "button";
      edit.className = "sc-act-menu-item";
      edit.textContent = "Edit comment";
      edit.addEventListener("click", () => {
        menu.hidden = true;
        this.openCommentEditor(m, entry);
      });
      menu.appendChild(edit);
    }

    if (showDelete) {
      const del = this.doc.createElement("button");
      del.type = "button";
      del.className = "sc-act-menu-item is-danger";
      del.textContent = "Delete comment";
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
          del.textContent = "Delete comment";
          menu.hidden = true;
          this.flash(entry, "Couldn't delete this comment.");
        }
      });
      menu.appendChild(del);
    }

    if (showLock) {
      const lock = this.doc.createElement("div");
      lock.className = "sc-act-menu-note";
      lock.textContent = `Can't edit or delete. ${modifyLockLabel(gate.lockReason)}`;
      menu.appendChild(lock);
    }

    btn.addEventListener("click", () => {
      menu.hidden = !menu.hidden;
    });
    wrap.append(btn, menu);
    return wrap;
  }

  /**
   * Inline editor for the author's own comment (0050): a note textarea plus a
   * reference-image composer (existing images removable, new ones attachable).
   * On save it uploads new images, calls editComment, and updates the read view
   * in place. Best-effort: a failed save keeps the editor open with a notice.
   */
  private openCommentEditor(m: PlacedMarker, entry: HTMLElement): void {
    const commentId = m.content?.id;
    if (!commentId || !this.thread) return;
    if (entry.querySelector(".sc-comment-edit")) return; // already editing

    const noteEl = entry.querySelector(".sc-comment-note") as HTMLElement | null;
    const galleryEl = entry.querySelector(".sc-ref-gallery") as HTMLElement | null;
    const setShown = (el: HTMLElement | null, shown: boolean) => {
      if (el) el.style.display = shown ? "" : "none";
    };
    setShown(noteEl, false);
    setShown(galleryEl, false);

    const form = this.doc.createElement("div");
    form.className = "sc-comment-edit";

    const input = this.doc.createElement("textarea") as HTMLTextAreaElement;
    input.className = "sc-reply-input sc-edit-input";
    input.value = m.content?.note ?? "";
    input.setAttribute("aria-label", "Edit comment");

    // Existing reference images the author keeps (removable) + newly attached.
    const kept = [...(m.content?.referenceImages ?? [])];
    const pending: string[] = [];
    const thumbs = this.doc.createElement("div");
    thumbs.className = "sc-compose-thumbs";
    void this.fillEditThumbs(kept, thumbs);

    const row = this.doc.createElement("div");
    row.className = "sc-edit-actions";
    if (this.uploader) row.appendChild(this.buildAttachControl(pending, thumbs));
    const save = this.doc.createElement("button");
    save.type = "button";
    save.className = "sc-btn-primary sc-edit-save";
    save.textContent = "Save";
    const cancel = this.doc.createElement("button");
    cancel.type = "button";
    cancel.className = "sc-btn-secondary sc-edit-cancel";
    cancel.textContent = "Cancel";

    const restore = () => {
      form.remove();
      setShown(noteEl, true);
      setShown(galleryEl, true);
    };
    cancel.addEventListener("click", () => restore());

    save.addEventListener("click", async () => {
      const note = input.value.trim();
      if (!note) {
        this.flash(form, "A comment needs a note.");
        return;
      }
      save.disabled = true;
      const newRefs = await this.uploadComposeImages(pending);
      const refs = [...kept, ...newRefs];
      const ok = await this.thread!.editComment(commentId, note, refs);
      save.disabled = false;
      if (!ok) {
        this.flash(form, "Couldn't save. Try again.");
        return;
      }
      // Reflect the edit in the marker content + the read view in place.
      if (m.content) {
        m.content.note = note;
        m.content.referenceImages = refs.length > 0 ? refs : undefined;
      }
      if (noteEl) noteEl.textContent = note;
      galleryEl?.remove();
      form.remove();
      setShown(noteEl, true);
      if (refs.length > 0 && noteEl?.parentElement) {
        const g = this.buildReferenceGallery(refs);
        noteEl.parentElement.insertBefore(g, noteEl.nextSibling);
      }
    });

    row.append(save, cancel);
    form.append(input, thumbs, row);
    entry.insertBefore(form, noteEl ?? null);
    input.focus?.();
  }

  /** Signed, removable thumbnails of a comment's EXISTING reference images (edit mode). */
  private async fillEditThumbs(kept: string[], thumbs: HTMLElement): Promise<void> {
    const thread = this.thread;
    if (!thread) return;
    const signer = (_bucket: string, path: string) => thread.signCapture(path);
    const refs = [...kept];
    await Promise.all(
      refs.map(async (ref) => {
        const url = await resolveCaptureSrc(ref, signer);
        if (!url) return;
        const chip = this.doc.createElement("div");
        chip.className = "sc-compose-thumb";
        const img = this.doc.createElement("img") as HTMLImageElement;
        img.src = url;
        img.alt = "Reference image";
        const remove = this.doc.createElement("button");
        remove.type = "button";
        remove.className = "sc-compose-remove";
        remove.textContent = "×";
        remove.setAttribute("aria-label", "Remove image");
        remove.addEventListener("click", () => {
          const i = kept.indexOf(ref);
          if (i >= 0) kept.splice(i, 1);
          chip.remove();
        });
        chip.append(img, remove);
        thumbs.appendChild(chip);
      }),
    );
  }

  /** Load and render the thread's replies into `container` (best-effort). */
  private async loadReplies(commentId: string, container: HTMLElement): Promise<void> {
    // Opening a thread marks it read for the viewer (0037/U12), best-effort.
    void this.thread?.markRead?.(commentId);
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
    if (r.body) {
      const body = this.doc.createElement("div");
      body.className = "sc-reply-body";
      body.textContent = r.body;
      main.appendChild(body);
    }
    // Attached reply images (R19) — signed + shown inline in the thread. Needs
    // the signer; an image-only reply (empty body) still shows its pictures.
    const imgs = r.image_refs;
    if (imgs && imgs.length > 0 && this.thread) {
      const shots = this.doc.createElement("div");
      shots.className = "sc-reply-shots";
      main.appendChild(shots);
      void this.fillCaptureThumbs(imgs, shots);
    }
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
    // Pending reply-image data URLs (uploaded out-of-band at send, R19). Local to
    // this composer; one removable preview thumb per pending image.
    const pending: string[] = [];
    const thumbs = this.doc.createElement("div");
    thumbs.className = "sc-compose-thumbs";

    const submit = async () => {
      const body = input.value.trim();
      if (!body && pending.length === 0) return; // image-only reply is allowed
      send.disabled = true;
      input.disabled = true;
      const refs = await this.uploadComposeImages(pending);
      const reply = await this.thread!.createReply(commentId, body, refs);
      send.disabled = false;
      input.disabled = false;
      if (reply) {
        list.appendChild(this.buildReplyElement(reply, list));
        input.value = "";
        pending.length = 0;
        thumbs.replaceChildren();
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
    // Attach control only when an uploader is wired (else a picked file is lost).
    if (this.uploader) box.appendChild(this.buildAttachControl(pending, thumbs));
    box.appendChild(send);
    box.appendChild(thumbs);
    return box;
  }

  /** The "attach image" button + hidden file input for the reply composer (R19). */
  private buildAttachControl(pending: string[], thumbs: HTMLElement): HTMLElement {
    const wrap = this.doc.createElement("span");
    wrap.className = "sc-reply-attach-wrap";
    const btn = this.doc.createElement("button");
    btn.type = "button";
    btn.className = "sc-reply-attach";
    btn.title = "Attach image";
    btn.setAttribute("aria-label", "Attach image");
    btn.textContent = "+";
    const file = this.doc.createElement("input") as HTMLInputElement;
    file.type = "file";
    file.setAttribute("accept", "image/png,image/jpeg,image/webp");
    file.setAttribute("multiple", "true");
    file.style.display = "none";
    file.addEventListener("change", () => {
      const list = (
        file as unknown as {
          files?: ArrayLike<Blob & { type: string; size: number }> | null;
        }
      ).files;
      const picked = list ? Array.from(list) : [];
      void this.addComposeImages(picked, pending, thumbs);
      try {
        file.value = "";
      } catch {
        /* some engines forbid clearing a file input's value */
      }
    });
    btn.addEventListener("click", () => file.click?.());
    wrap.append(btn, file);
    return wrap;
  }

  /** Validate + read each picked file to a data URL; add a removable preview thumb. */
  private async addComposeImages(
    files: Array<Blob & { type: string; size: number }>,
    pending: string[],
    thumbs: HTMLElement,
  ): Promise<void> {
    for (const file of files) {
      if (!isValidCaptureImage({ type: file.type, size: file.size })) continue;
      const dataUrl = await this.readImageFile(file);
      if (!dataUrl) continue;
      pending.push(dataUrl);
      thumbs.appendChild(this.buildComposeThumb(dataUrl, pending));
    }
  }

  /** A pending-image preview chip (its data URL) with a remove button. */
  private buildComposeThumb(dataUrl: string, pending: string[]): HTMLElement {
    const chip = this.doc.createElement("div");
    chip.className = "sc-compose-thumb";
    const img = this.doc.createElement("img") as HTMLImageElement;
    img.src = dataUrl;
    img.alt = "Attached image";
    const remove = this.doc.createElement("button");
    remove.type = "button";
    remove.className = "sc-compose-remove";
    remove.textContent = "×";
    remove.setAttribute("aria-label", "Remove image");
    remove.addEventListener("click", () => {
      const idx = pending.indexOf(dataUrl);
      if (idx >= 0) pending.splice(idx, 1);
      chip.remove();
    });
    chip.append(img, remove);
    return chip;
  }

  /** Upload pending data URLs out-of-band → refs; skip failures. Empty with no uploader. */
  private async uploadComposeImages(pending: string[]): Promise<string[]> {
    const uploader = this.uploader;
    if (!uploader || pending.length === 0) return [];
    const results = await Promise.all(
      pending.map((d) => uploader.uploadDataUrl(d).catch(() => null)),
    );
    return results.filter((r): r is string => !!r);
  }

  /** Read a File/Blob to a data URL; null on failure (browser FileReader). */
  private readImageFile(file: Blob): Promise<string | null> {
    return new Promise((resolve) => {
      try {
        const FR = (globalThis as unknown as { FileReader?: typeof FileReader })
          .FileReader;
        if (!FR) {
          resolve(null);
          return;
        }
        const reader = new FR();
        reader.onload = () =>
          resolve(typeof reader.result === "string" ? reader.result : null);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(file);
      } catch {
        resolve(null);
      }
    });
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
