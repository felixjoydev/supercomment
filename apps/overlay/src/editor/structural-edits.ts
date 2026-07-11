/**
 * U11 — structural edits (add / delete / hide / reorder / swap), NON-DESTRUCTIVE.
 *
 * Real DOM reorder/delete on framework-owned nodes throws `NotFoundError` on the
 * next reconcile and reverts (G12), so we NEVER move or remove real nodes for the
 * preview. Instead we record the semantic INTENT (the durable artifact) and
 * preview via CSS only — `display:none` to hide, the `order` property to reorder
 * (flex/grid). Each op carries a concrete insertion/removal point relative to an
 * anchored neighbour so the agent can locate it in source. Media swap is a
 * `setAttr` on `src`.
 *
 * The pure op-builders are unit-tested here; the anchored EditTarget / insertion
 * points are assembled by the capture layer at wire time (reusing reanchor.ts).
 */
import type {
  ChangeOp,
  EditTarget,
  InsertionPoint,
  NewNode,
} from "@supercomment/shared";

import { newOpId } from "./style-edits.js";

/** Add a new element at a concrete insertion point (semantic node, not raw HTML). */
export function buildInsertOp(
  insertion: InsertionPoint,
  node: NewNode,
  target?: EditTarget,
): ChangeOp {
  return {
    opId: newOpId(),
    type: "insertNode",
    target:
      target ?? insertion.parent ?? insertion.reference ?? emptyTarget(),
    insertion,
    node,
  };
}

/** Delete an existing element (recorded as intent; preview hides, never removes). */
export function buildRemoveOp(target: EditTarget): ChangeOp {
  return { opId: newOpId(), type: "removeNode", target };
}

/** Hide (or reveal) an element. Coalesces: hide-then-show cancels to a no-op. */
export function buildSetVisibilityOp(
  target: EditTarget,
  hidden: boolean,
): ChangeOp {
  return {
    opId: newOpId(),
    type: "setVisibility",
    target,
    before: hidden ? "visible" : "hidden",
    after: hidden ? "hidden" : "visible",
  };
}

/** Reorder a sibling to a new position, anchored to its parent + destination. */
export function buildMoveOp(
  target: EditTarget,
  insertion: InsertionPoint,
  from: number,
  to: number,
): ChangeOp {
  return {
    opId: newOpId(),
    type: "moveNode",
    target,
    insertion,
    order: { from, to },
  };
}

/** Swap an image/media source (setAttr on `src`). */
export function buildSwapMediaOp(
  target: EditTarget,
  beforeSrc: string | null,
  afterSrc: string,
): ChangeOp {
  return {
    opId: newOpId(),
    type: "setAttr",
    target,
    property: "src",
    before: beforeSrc,
    after: afterSrc,
  };
}

function emptyTarget(): EditTarget {
  return { selector: "body", anchors: [] };
}

// ---------------------------------------------------------------------------
// Replace-image (swap) safety + preview (U6).
// ---------------------------------------------------------------------------

/** A private / non-public host (SSRF + localhost surface) — rejected on URL entry. */
function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".localhost")) return true;
  if (h === "::1" || h === "0.0.0.0") return true;
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true; // link-local
  return false;
}

export interface SwapUrlVerdict {
  /** Safe to accept as a swap target at all (author preview + record). */
  ok: boolean;
  /** Same-origin as the reviewed page (safe to re-apply to OTHER viewers). */
  sameOrigin: boolean;
  reason?: "empty" | "invalid" | "not-https" | "private-host";
}

/**
 * Classify a reviewer-entered swap URL (U6). For ENTRY we require https to a
 * public host (never http, blob:, data:, javascript:, or a private/localhost
 * host). `sameOrigin` reports whether it matches the reviewed page's origin —
 * only same-origin URLs are re-applied to OTHER viewers; a cross-origin
 * third-party URL is recorded as intent and previewed for the author only.
 */
export function classifySwapUrl(raw: string, pageOrigin?: string): SwapUrlVerdict {
  const s = (raw ?? "").trim();
  if (!s) return { ok: false, sameOrigin: false, reason: "empty" };
  let u: URL;
  try {
    u = new URL(s, pageOrigin ?? "https://reviewed.example");
  } catch {
    return { ok: false, sameOrigin: false, reason: "invalid" };
  }
  if (u.protocol !== "https:") return { ok: false, sameOrigin: false, reason: "not-https" };
  if (isPrivateHost(u.hostname)) return { ok: false, sameOrigin: false, reason: "private-host" };
  let sameOrigin = false;
  if (pageOrigin) {
    try {
      sameOrigin = u.host === new URL(pageOrigin).host;
    } catch {
      sameOrigin = false;
    }
  }
  return { ok: true, sameOrigin };
}

/**
 * Whether a swapped media `src` is safe to RE-APPLY into ANOTHER viewer's DOM
 * (the apply-change-set gate, U6). Only same-origin https (or a relative /
 * root-relative URL) is re-applied; a blob:/data:/javascript:/third-party URL is
 * record-intent-only, so the recorded swap can never become an SSRF, beacon, or
 * CSRF channel aimed at whoever opens the comment. Uploaded replacements are
 * delivered as signed refs out of band, never as a raw src here.
 */
export function isReapplicableMediaSrc(src: string, pageOrigin: string): boolean {
  const s = (src ?? "").trim();
  if (!s) return false;
  if (/^(blob|data|javascript|file|about|ftp):/i.test(s)) return false;
  // Relative or root-relative (no scheme, not protocol-relative) → same-origin.
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(s);
  if (!hasScheme && !s.startsWith("//")) return true;
  try {
    const u = new URL(s, pageOrigin);
    return u.protocol === "https:" && u.host === new URL(pageOrigin).host;
  } catch {
    return false;
  }
}

/** Captured original media attributes for an exact swap restore. */
interface MediaSnapshot {
  el: Element;
  attr: string;
  value: string | null;
}

export interface SwapPreview {
  /** Restore the img + any <picture><source> children byte-identical. */
  restore(): void;
}

/**
 * Preview an image swap (U6): set the img's `src` to `newSrc` and NEUTRALIZE the
 * responsive machinery that would otherwise override it — the img's own srcset +
 * sizes, and every `<source>` child's srcset + media when the target sits inside
 * a `<picture>` — recording each prior value for a byte-identical restore. Without
 * this the browser re-selects a source and the swap never actually shows. Never
 * throws; the returned `restore` puts everything back.
 */
export function previewSwapMedia(el: Element, newSrc: string): SwapPreview {
  const snaps: MediaSnapshot[] = [];
  const capture = (node: Element, attr: string): void => {
    try {
      snaps.push({ el: node, attr, value: node.getAttribute?.(attr) ?? null });
    } catch {
      /* best-effort */
    }
  };
  const clear = (node: Element, attr: string): void => {
    try {
      node.removeAttribute?.(attr);
    } catch {
      /* best-effort */
    }
  };
  try {
    // Neutralize the responsive picker on the img itself.
    capture(el, "srcset");
    capture(el, "sizes");
    clear(el, "srcset");
    clear(el, "sizes");
    // And on each <source> child when inside a <picture>.
    const parent = el.parentElement;
    if (parent && (parent.tagName || "").toLowerCase() === "picture") {
      for (const child of Array.from(parent.children)) {
        if ((child.tagName || "").toLowerCase() !== "source") continue;
        capture(child, "srcset");
        capture(child, "media");
        clear(child, "srcset");
        clear(child, "media");
      }
    }
    capture(el, "src");
    el.setAttribute?.("src", newSrc);
  } catch {
    /* best-effort preview */
  }
  return {
    restore: () => {
      // Restore in reverse so src lands last (after srcset/sizes are back).
      for (const s of [...snaps].reverse()) {
        try {
          if (s.value == null) s.el.removeAttribute?.(s.attr);
          else s.el.setAttribute?.(s.attr, s.value);
        } catch {
          /* best-effort restore */
        }
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Non-destructive CSS previews (never move/remove real nodes — G12).
// ---------------------------------------------------------------------------

/** Hide via `display:none`; returns the prior inline display for revert. Never throws. */
export function previewHide(el: Element): string | null {
  try {
    const style = (el as HTMLElement).style;
    const prev = style?.display ?? null;
    style?.setProperty?.("display", "none");
    return prev ?? null;
  } catch {
    return null;
  }
}

/** Revert a {@link previewHide}, restoring the prior inline display. Never throws. */
export function previewShow(el: Element, priorDisplay: string | null): void {
  try {
    const style = (el as HTMLElement).style;
    if (priorDisplay) {
      style?.setProperty?.("display", priorDisplay);
    } else {
      style?.removeProperty?.("display");
    }
  } catch {
    /* best-effort */
  }
}

/** Non-destructive reorder preview via CSS `order` (flex/grid). Never throws.
 * NOTE (U5): both the live editor AND the saved-template re-apply now use
 * {@link previewMove} (a real DOM move) so preview and re-apply are identical
 * (R5); this CSS-`order` helper is retained only as a low-level utility. */
export function previewOrder(el: Element, order: number): void {
  try {
    (el as HTMLElement).style?.setProperty?.("order", String(order));
  } catch {
    /* best-effort */
  }
}

/**
 * REAL reorder preview (requirement F): actually move `el` before/after
 * `reference` in the DOM so the reviewer SEES it (CSS `order` does nothing
 * outside a flex/grid parent). This is deliberately mutating — the durable
 * artifact is the anchored `moveNode` op, and the mutation is EPHEMERAL: the
 * returned closure restores `el` to its exact original position (before the
 * captured original next-sibling, or its original parent), so close/undo/discard
 * reverts it cleanly. Framework re-renders may still revert the preview (G12);
 * that's fine — it's throwaway. Never throws; the revert is a no-op if the move
 * couldn't be applied.
 */
export function previewMove(
  el: Element,
  reference: Element | null,
  position: "before" | "after",
): () => void {
  let restore: (() => void) | null = null;
  try {
    const origParent = el.parentElement;
    if (!origParent) return () => {};
    // Snapshot the exact original position for an exact restore.
    const origNext = (el as { nextSibling?: ChildNode | null }).nextSibling ?? null;
    restore = () => {
      try {
        domInsertBefore(origParent, el, origNext);
      } catch {
        /* best-effort restore */
      }
    };

    const destParent = reference?.parentElement ?? origParent;
    const refNext =
      (reference as { nextSibling?: ChildNode | null } | null)?.nextSibling ?? null;
    // before → insert at the reference; after → insert at the reference's next
    // sibling (which, once el is removed, is the slot just past the reference).
    const anchor =
      position === "before" ? (reference as ChildNode | null) : refNext;
    domInsertBefore(destParent, el, anchor);
  } catch {
    /* preview is best-effort; keep whatever restore we captured */
  }
  return restore ?? (() => {});
}

/** `parent.insertBefore(node, ref)` with an append fallback (test doubles). */
function domInsertBefore(
  parent: Element,
  node: Element,
  ref: ChildNode | null,
): void {
  const fn = (parent as {
    insertBefore?: (n: Element, r: ChildNode | null) => void;
  }).insertBefore;
  if (typeof fn === "function") fn.call(parent, node, ref);
  else parent.appendChild(node);
}
