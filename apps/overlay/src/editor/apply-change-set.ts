/**
 * U14 — opt-in modified view.
 *
 * The default view is always the developer's live build. When a viewer SELECTS a
 * saved `template`, we re-apply its change-set to the live DOM from a clean state
 * so they see the proposed result; DESELECTING restores the live build exactly.
 * Nothing is ever auto-applied or replayed onto later builds (R5/R6).
 *
 * Each op is applied EPHEMERALLY (the same CSS/text/visibility previews the
 * editor used — never a destructive mutation of framework-owned nodes, G12) and
 * paired with a REVERT closure that captured the element's pre-apply state, so
 * deselect is an exact restore. Targets are re-resolved with the corroborate-or
 * -stale resolver (`reanchor.ts`): an op whose element can't be confidently found
 * on THIS build is skipped, never guessed.
 *
 * Build-drift guard (G8/G10): a change-set carries the commit it was authored
 * against. If that differs from the page's commit, we REFUSE to re-apply (the
 * live DOM has moved on) and report `stale` so the caller shows the stored
 * screenshot instead of a misleading live re-apply.
 */
import type { ChangeOp, EditTarget, VisualChangeSet } from "@supercomment/shared";
import { isInsertableTag, isSafeAttr } from "@supercomment/shared";

import { resolveAnchors } from "../capture/reanchor.js";
import { applyStylePreview, applyTextPreview } from "./style-edits.js";
import { previewHide, previewOrder, previewShow } from "./structural-edits.js";

/** A minimal MutationObserver surface (feature-detected; real-env only). */
interface MutationObserverLike {
  observe(target: Node, options: MutationObserverInit): void;
  disconnect(): void;
}

/** How one op is (re-)applied to and reverted from the live DOM. */
interface OpBinding {
  /** (Re-)assert the op's desired state — idempotent, captures nothing new. */
  apply(): void;
  /** Restore the element's pre-apply state. */
  revert(): void;
}

export interface ApplyOptions {
  /** The commit the current page was built from (drives the drift guard). */
  pageCommit?: string;
  /** Resolve an op target to a live element; defaults to the reanchor resolver. */
  resolve?: (target: EditTarget, doc: Document) => Element | null;
}

/** The per-op outcome of a re-apply, for the applied/skipped summary (R9). */
export interface OpOutcome {
  opId: string;
  type: ChangeOp["type"];
  applied: boolean;
  /** Why an op was skipped: its target didn't resolve, or it was inapplicable. */
  reason?: "unresolved" | "inapplicable";
}

export interface ApplyResult {
  /** Ops applied to a resolved element. */
  applied: number;
  /** Ops skipped (target not confidently resolved, or op not applicable). */
  skipped: number;
  /** Per-op outcome — which edits applied on this page and which were skipped (R9). */
  results: OpOutcome[];
  /** True when the change-set targets a DIFFERENT build → nothing was applied. */
  stale: boolean;
  /** Restore the live DOM to its pre-apply state (deselect). */
  revert(): void;
  /** Re-assert the applied ops (used by the MutationObserver re-assert). */
  reassert(): void;
}

/**
 * The default target resolver. When the op carries anchors they are AUTHORITATIVE
 * — corroborate-or-stale via reanchor, and if it can't confidently resolve we
 * return null (skip), NEVER fall back to a selector's first match (that would
 * "guess" an ambiguous target across pages, R9). Only an anchor-less target
 * (e.g. an area/text edit) uses the best-effort selector.
 */
function defaultResolve(target: EditTarget, doc: Document): Element | null {
  if (target.anchors && target.anchors.length > 0) {
    return resolveAnchors(target.anchors, doc).element;
  }
  try {
    return doc.querySelector(target.selector);
  } catch {
    return null;
  }
}

/**
 * Apply a saved change-set to the live DOM. Returns counts + a `revert()` that
 * exactly restores the pre-apply state, or `{ stale:true }` (nothing applied)
 * when the change-set was authored against a different build.
 */
export function applyChangeSet(
  changeSet: VisualChangeSet,
  doc: Document,
  options: ApplyOptions = {},
): ApplyResult {
  // Drift guard: only when BOTH commits are known and they disagree.
  if (
    changeSet.authoredCommit &&
    options.pageCommit &&
    changeSet.authoredCommit !== options.pageCommit
  ) {
    return {
      applied: 0,
      skipped: changeSet.ops.length,
      results: [],
      stale: true,
      revert() {},
      reassert() {},
    };
  }

  const resolve = options.resolve ?? defaultResolve;
  const bindings: OpBinding[] = [];
  const results: OpOutcome[] = [];
  let applied = 0;
  let skipped = 0;

  for (const op of changeSet.ops) {
    const el = resolve(op.target, doc);
    if (!el) {
      skipped++;
      results.push({ opId: op.opId, type: op.type, applied: false, reason: "unresolved" });
      continue;
    }
    const binding = bindOp(op, el, doc);
    if (!binding) {
      skipped++;
      results.push({ opId: op.opId, type: op.type, applied: false, reason: "inapplicable" });
      continue;
    }
    binding.apply();
    bindings.push(binding);
    applied++;
    results.push({ opId: op.opId, type: op.type, applied: true });
  }

  return {
    applied,
    skipped,
    results,
    stale: false,
    revert() {
      // Reverse order so nested/dependent changes unwind cleanly.
      for (const b of [...bindings].reverse()) {
        try {
          b.revert();
        } catch {
          /* best-effort restore */
        }
      }
    },
    reassert() {
      for (const b of bindings) {
        try {
          b.apply();
        } catch {
          /* best-effort */
        }
      }
    },
  };
}

/**
 * Bind one op to a resolved element: capture its pre-apply state and return
 * `apply`/`revert` closures. Returns `null` for an op that can't be applied
 * (missing property/value). Never throws.
 */
function bindOp(
  op: VisualChangeSet["ops"][number],
  el: Element,
  doc: Document,
): OpBinding | null {
  const style = (el as HTMLElement).style as
    | (CSSStyleDeclaration & {
        getPropertyValue?: (p: string) => string;
        removeProperty?: (p: string) => void;
      })
    | undefined;

  switch (op.type) {
    case "setStyle": {
      const prop = op.property;
      if (!prop || op.after == null) return null;
      const prev = style?.getPropertyValue?.(prop) ?? "";
      return {
        apply: () => applyStylePreview(el, prop, op.after as string),
        revert: () =>
          prev ? applyStylePreview(el, prop, prev) : style?.removeProperty?.(prop),
      };
    }
    case "setText": {
      if (op.after == null) return null;
      const prev = el.textContent ?? "";
      return {
        apply: () => applyTextPreview(el, op.after as string),
        revert: () => applyTextPreview(el, prev),
      };
    }
    case "setAttr": {
      const prop = op.property;
      if (!prop || op.after == null) return null;
      // M1: never let a saved change-set set an event handler / javascript:-URL
      // attribute on a viewer's element (stored-DOM-XSS). Skip the op instead.
      if (!isSafeAttr(prop, op.after as string)) return null;
      const prev = el.getAttribute?.(prop);
      return {
        apply: () => {
          try {
            el.setAttribute?.(prop, op.after as string);
          } catch {
            /* best-effort */
          }
        },
        revert: () => {
          if (prev == null) el.removeAttribute?.(prop);
          else el.setAttribute?.(prop, prev);
        },
      };
    }
    case "removeNode":
    case "setVisibility": {
      // Both hide the element non-destructively (removeNode is intent; the
      // preview hides). A setVisibility→"visible" op instead reveals it.
      const reveal = op.type === "setVisibility" && op.after === "visible";
      if (reveal) {
        const prevDisplay = style?.display ?? "";
        return {
          apply: () => previewShow(el, ""),
          revert: () =>
            prevDisplay ? applyStylePreview(el, "display", prevDisplay) : undefined,
        };
      }
      let prevDisplay: string | null = null;
      return {
        apply: () => {
          prevDisplay = previewHide(el);
        },
        revert: () => previewShow(el, prevDisplay),
      };
    }
    case "moveNode": {
      if (!op.order) return null;
      const prevOrder = style?.getPropertyValue?.("order") ?? "";
      return {
        apply: () => previewOrder(el, op.order!.to),
        revert: () =>
          prevOrder
            ? previewOrder(el, Number(prevOrder))
            : style?.removeProperty?.("order"),
      };
    }
    case "insertNode": {
      if (!op.node) return null;
      // M1: an unsafe tag makes the op inapplicable (skipped) rather than a
      // no-op "applied". makeGhost re-checks as defense in depth.
      if (!isInsertableTag(op.node.tag || "div")) return null;
      let ghost: Element | null = null;
      return {
        apply: () => {
          if (ghost) return; // already inserted
          ghost = makeGhost(op.node!, doc);
          if (ghost) insertGhost(el, ghost, op.insertion?.position ?? "after");
        },
        revert: () => {
          ghost?.remove();
          ghost = null;
        },
      };
    }
    default:
      return null;
  }
}

/**
 * Build an ephemeral ghost node for an inserted element (ours; safe to remove).
 *
 * M1: a change-set is attacker-influenceable, so the tag is allow-listed
 * (`isInsertableTag` — no `script`/`iframe`/…) and every attribute is filtered
 * through `isSafeAttr` (no `on*` handlers, no `javascript:`/hostile-`data:` URL
 * values). An op with an unsafe tag yields no ghost (skipped); unsafe attributes
 * are dropped while the safe rest of the node still renders.
 */
function makeGhost(
  node: NonNullable<VisualChangeSet["ops"][number]["node"]>,
  doc: Document,
): Element | null {
  const tag = node.tag || "div";
  if (!isInsertableTag(tag)) return null;
  try {
    const ghost = doc.createElement(tag);
    ghost.setAttribute("data-sc-ghost", "1");
    if (node.text) ghost.textContent = node.text;
    for (const [k, v] of Object.entries(node.attrs ?? {})) {
      if (!isSafeAttr(k, v)) continue; // drop an unsafe attribute, keep the node
      try {
        ghost.setAttribute(k, v);
      } catch {
        /* skip an invalid attribute name */
      }
    }
    return ghost;
  } catch {
    return null;
  }
}

/** Insert `ghost` relative to `ref` per the op's position (best-effort). */
function insertGhost(
  ref: Element,
  ghost: Element,
  position: "before" | "after" | "append" | "prepend",
): void {
  try {
    const parent = ref.parentElement;
    if (position === "append") {
      ref.appendChild(ghost);
      return;
    }
    if (position === "prepend") {
      const first = (ref as { firstChild?: ChildNode | null }).firstChild ?? null;
      insertBefore(ref, ghost, first);
      return;
    }
    if (!parent) {
      ref.appendChild(ghost);
      return;
    }
    const next = (ref as { nextSibling?: ChildNode | null }).nextSibling ?? null;
    insertBefore(parent, ghost, position === "after" ? next : ref);
  } catch {
    /* best-effort */
  }
}

function insertBefore(
  parent: Element,
  node: Element,
  ref: ChildNode | Element | null,
): void {
  const fn = (parent as {
    insertBefore?: (n: Element, r: ChildNode | null) => void;
  }).insertBefore;
  if (typeof fn === "function") fn.call(parent, node, (ref as ChildNode) ?? null);
  else parent.appendChild(node);
}

/**
 * Single-active opt-in view (G7): selecting a template applies it; selecting a
 * different one reverts the first (never composed); deselect restores the live
 * build. A drifted change-set is not applied — the caller shows the screenshot.
 * A scoped MutationObserver re-asserts the preview if the framework reverts it
 * (best-effort, real-env; a no-op where MutationObserver is unavailable).
 */
export class ModifiedViewController {
  private active:
    | { id: string; result: ApplyResult; observer?: MutationObserverLike }
    | null = null;

  constructor(
    private readonly doc: Document,
    private readonly options: ApplyOptions = {},
  ) {}

  /** The id of the currently-applied template, or null when showing live. */
  activeId(): string | null {
    return this.active?.id ?? null;
  }

  /**
   * Show template `id`'s modified view. Reverts any other active template first
   * (single-active). Returns the apply result — `stale:true` means the caller
   * should show the stored screenshot instead (drift).
   */
  select(
    id: string,
    changeSet: VisualChangeSet,
    options: ApplyOptions = {},
  ): ApplyResult {
    if (this.active?.id === id) return this.active.result;
    this.deselect();
    const result = applyChangeSet(changeSet, this.doc, {
      ...this.options,
      ...options,
    });
    if (result.stale) return result; // drifted → nothing applied; show screenshot
    const observer = this.watch(result);
    this.active = observer ? { id, result, observer } : { id, result };
    return result;
  }

  /** Restore the live build (deselect the active template). */
  deselect(): void {
    if (!this.active) return;
    this.active.observer?.disconnect();
    this.active.result.revert();
    this.active = null;
  }

  private watch(result: ApplyResult): MutationObserverLike | undefined {
    const view = this.doc.defaultView as
      | { MutationObserver?: new (cb: () => void) => MutationObserverLike }
      | undefined;
    const Ctor = view?.MutationObserver;
    const root = this.doc.body ?? this.doc.documentElement;
    if (!Ctor || !root) return undefined;
    const opts: MutationObserverInit = {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    };
    let observer: MutationObserverLike | undefined;
    observer = new Ctor(() => {
      // Re-assert without observing our own mutations (avoid a feedback loop).
      observer?.disconnect();
      result.reassert();
      observer?.observe(root, opts);
    });
    observer.observe(root, opts);
    return observer;
  }
}
