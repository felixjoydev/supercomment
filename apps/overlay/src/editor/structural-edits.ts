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
 * Retained for the saved-template re-apply path (apply-change-set.ts); the live
 * editor uses {@link previewMove} instead, since CSS `order` is a no-op outside a
 * flex/grid parent (requirement F). */
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
