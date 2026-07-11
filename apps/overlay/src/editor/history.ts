/**
 * U3 — the edit history engine (the state core's source of truth).
 *
 * One authoritative structure behind BOTH the change-set projection and the
 * live-DOM undo/redo, replacing the two parallel structures it absorbs:
 *   - the coalescing edit buffer (EditSession's op map + original-before
 *     preservation + net-no-op drop), and
 *   - the ephemeral revert log (PreviewLog's first-write-wins DOM reverts).
 *
 * Why unify (the plan's rationale): redo + list-revert + gesture coalescing
 * cannot be expressed on first-write-wins revert closures, and two revert
 * authorities would drift. So this owns:
 *
 *   - a first-write-wins BASELINE registry per key (the developer build's value
 *     + a DOM revert-to-build), never evicted, so a saved change-set's `before`
 *     stays build-true even after the undo cap evicts old steps;
 *   - a TIP map per key (the current value + a DOM redo closure), which the
 *     PROJECTION reads (before from baseline, after from tip, dropping keys whose
 *     normalized before == after via the U1 registry); and
 *   - undo/redo stacks of gesture-scoped steps (push-applied: the authoring
 *     surface already performed the write, so a step's `apply` runs only on redo).
 *
 * Pure and dependency-light (holds only ops + thunks), so it is fully unit-
 * testable under the node doubles; DOM effects are injected as closures.
 */
import type { ChangeOp, VisualChangeSet } from "@supercomment/shared";

import { opKey } from "./op-key.js";
import { getPropertyMeta } from "./property-meta.js";
import { basicProbe, type ColorProbe } from "./color/normalize.js";

/** The DOM effects for one edit, captured by the authoring surface. */
export interface EditDom {
  /** Set the DOM to this edit's after-state (redo one step). */
  apply(): void;
  /** Set the DOM to the state right before this edit (undo one step). */
  invert(): void;
  /** Restore the DOM to the developer build for this key (first-write-wins kept). */
  revertToBuild(): void;
}

/** A row for the edits-list popover. */
export interface EditListRow {
  key: string;
  label: string;
  op: ChangeOp;
}

interface TipEntry {
  op: ChangeOp;
  /** Re-apply this key's current value to the DOM (used when undoing a revert). */
  redo(): void;
}

interface Baseline {
  /** The first op recorded for the key — carries the build `before` (+ move origin). */
  firstOp: ChangeOp;
  /** Restore the DOM to the developer build for this key (first-write-wins). */
  revertToBuild(): void;
}

interface Change {
  key: string;
  prev: TipEntry | null;
  next: TipEntry | null;
}

interface Step {
  label: string;
  changes: Change[];
  /** Redo the whole step's DOM mutation. */
  apply(): void;
  /** Undo the whole step's DOM mutation. */
  invert(): void;
  /** Set only for single-key nudge steps eligible to merge with the next same-key edit. */
  mergeKey: string | null;
}

const DEFAULT_CAP = 150;

export interface HistoryOptions {
  cap?: number;
  probe?: ColorProbe;
  authoredCommit?: string;
  onChange?: () => void;
}

export class HistoryEngine {
  private readonly baseline = new Map<string, Baseline>();
  private readonly tip = new Map<string, TipEntry>();
  private undoStack: Step[] = [];
  private redoStack: Step[] = [];
  private gesture: Map<string, { prev: TipEntry | null; last: TipEntry; label: string; invert: () => void; apply: () => void }> | null = null;
  private readonly cap: number;
  private readonly probe: ColorProbe;
  private readonly authoredCommit?: string;
  private readonly listeners = new Set<() => void>();

  constructor(opts: HistoryOptions = {}) {
    this.cap = opts.cap ?? DEFAULT_CAP;
    this.probe = opts.probe ?? basicProbe;
    this.authoredCommit = opts.authoredCommit;
    if (opts.onChange) this.listeners.add(opts.onChange);
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) {
      try {
        fn();
      } catch {
        /* a subscriber must never throw into the edit path */
      }
    }
  }

  // --- Recording -----------------------------------------------------------

  /**
   * Record one edit. The authoring surface has ALREADY performed the verified DOM
   * write; `dom` carries the closures to redo/undo/revert it. Coalesces with the
   * current tip for the key (original build `before` preserved), clears the redo
   * stack, and either opens/extends a gesture, merges a repeated nudge, or pushes
   * a new undo step.
   */
  record(op: ChangeOp, dom: EditDom, opts: { mergeable?: boolean; label?: string } = {}): void {
    const key = opKey(op);
    if (!this.baseline.has(key)) {
      this.baseline.set(key, { firstOp: op, revertToBuild: dom.revertToBuild });
    }
    const prev = this.tip.get(key) ?? null;
    const merged = this.mergeWithBaseline(key, op);
    const nextEntry: TipEntry = { op: merged, redo: dom.apply };
    this.tip.set(key, nextEntry);
    this.redoStack = [];
    const label = opts.label ?? labelOp(merged);

    if (this.gesture) {
      const existing = this.gesture.get(key);
      if (existing) {
        existing.last = nextEntry;
        existing.apply = dom.apply;
        existing.label = label;
      } else {
        this.gesture.set(key, { prev, last: nextEntry, label, invert: dom.invert, apply: dom.apply });
      }
      this.emit();
      return;
    }

    // Merge a repeated nudge into the top step (same single key, both mergeable).
    const top = this.undoStack[this.undoStack.length - 1];
    if (opts.mergeable && top && top.mergeKey === key && top.changes.length === 1) {
      top.changes[0]!.next = nextEntry;
      top.apply = dom.apply;
      top.label = label;
      this.emit();
      return;
    }

    this.pushStep({
      label,
      changes: [{ key, prev, next: nextEntry }],
      apply: dom.apply,
      invert: dom.invert,
      mergeKey: opts.mergeable ? key : null,
    });
    this.emit();
  }

  /** Begin a gesture: subsequent records coalesce into ONE undo step until commit. */
  beginGesture(): void {
    if (!this.gesture) this.gesture = new Map();
  }

  /** Commit the open gesture as a single undo step (no-op if it touched nothing). */
  commitGesture(): void {
    const g = this.gesture;
    this.gesture = null;
    if (!g || g.size === 0) {
      this.emit();
      return;
    }
    const changes: Change[] = [];
    const applies: Array<() => void> = [];
    const inverts: Array<() => void> = [];
    let label = "";
    for (const [key, acc] of g) {
      changes.push({ key, prev: acc.prev, next: acc.last });
      applies.push(acc.apply);
      inverts.push(acc.invert);
      label = acc.label;
    }
    if (g.size > 1) label = `${g.size} edits`;
    this.pushStep({
      label,
      changes,
      apply: () => applies.forEach((f) => safe(f)),
      invert: () => inverts.forEach((f) => safe(f)),
      mergeKey: null,
    });
    this.emit();
  }

  // --- Undo / redo ---------------------------------------------------------

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Undo the most recent step (reverts DOM + tip). Returns the primary op undone. */
  undo(): ChangeOp | null {
    const step = this.undoStack.pop();
    if (!step) return null;
    safe(() => step.invert());
    for (const c of step.changes) this.setTip(c.key, c.prev);
    this.redoStack.push(step);
    this.emit();
    return step.changes[0]?.next?.op ?? null;
  }

  /** Redo the most recently undone step. */
  redo(): void {
    const step = this.redoStack.pop();
    if (!step) return;
    safe(() => step.apply());
    for (const c of step.changes) this.setTip(c.key, c.next);
    this.undoStack.push(step);
    this.emit();
  }

  // --- List revert / discard / reset --------------------------------------

  /**
   * Revert one key to the developer build (edits-list per-row revert): restores
   * the DOM to build now and appends ONE undoable step (undoing it re-applies the
   * edit). No-op when the key is not currently edited.
   */
  revertKey(key: string): void {
    const entry = this.tip.get(key);
    const base = this.baseline.get(key);
    if (!entry || !base) return;
    safe(() => base.revertToBuild());
    this.setTip(key, null);
    this.redoStack = [];
    this.pushStep({
      label: `revert ${labelOp(entry.op)}`,
      changes: [{ key, prev: entry, next: null }],
      apply: () => base.revertToBuild(),
      invert: () => entry.redo(),
      mergeKey: null,
    });
    this.emit();
  }

  /**
   * Discard every edit to the developer build (undoable): restores all touched
   * keys' DOM to build now and appends ONE undoable step whose undo re-applies
   * every reverted edit.
   */
  discardAll(): void {
    if (this.tip.size === 0) return;
    const snapshot: Array<{ key: string; entry: TipEntry }> = [];
    for (const [key, entry] of this.tip) snapshot.push({ key, entry });
    const revertAll = (): void => {
      for (const { key } of snapshot) {
        const base = this.baseline.get(key);
        if (base) safe(() => base.revertToBuild());
      }
    };
    revertAll();
    for (const { key } of snapshot) this.setTip(key, null);
    this.redoStack = [];
    this.pushStep({
      label: "discard all",
      changes: snapshot.map(({ key, entry }) => ({ key, prev: entry, next: null })),
      apply: revertAll,
      invert: () => snapshot.forEach(({ entry }) => safe(() => entry.redo())),
      mergeKey: null,
    });
    this.emit();
  }

  /**
   * Non-undoable reset: revert every touched key's DOM to the developer build and
   * clear all state. Used on successful save and on teardown (the modified state
   * is captured in the comment; the live DOM returns to build).
   */
  resetToBuild(): void {
    for (const base of this.baseline.values()) safe(() => base.revertToBuild());
    this.baseline.clear();
    this.tip.clear();
    this.undoStack = [];
    this.redoStack = [];
    this.gesture = null;
    this.emit();
  }

  // --- Projection (the change-set facade) ----------------------------------

  isEmpty(): boolean {
    return this.projectOps().length === 0;
  }

  get size(): number {
    return this.projectOps().length;
  }

  hasKey(key: string): boolean {
    return this.tip.has(key);
  }

  /** The net change-set ops (before=build, after=tip), dropping normalized no-ops. */
  projectOps(): ChangeOp[] {
    const out: ChangeOp[] = [];
    for (const entry of this.tip.values()) {
      if (!this.isNetNoOp(entry.op)) out.push(entry.op);
    }
    return out;
  }

  entries(): EditListRow[] {
    return this.projectOps().map((op) => ({ key: opKey(op), label: labelOp(op), op }));
  }

  toChangeSet(): VisualChangeSet | null {
    const ops = this.projectOps();
    if (ops.length === 0) return null;
    return {
      ...(this.authoredCommit ? { authoredCommit: this.authoredCommit } : {}),
      ops,
    };
  }

  // --- Internals -----------------------------------------------------------

  private setTip(key: string, entry: TipEntry | null): void {
    if (entry) this.tip.set(key, entry);
    else this.tip.delete(key);
  }

  private pushStep(step: Step): void {
    this.undoStack.push(step);
    while (this.undoStack.length > this.cap) this.undoStack.shift(); // cap undo DEPTH only
  }

  /**
   * Preserve the true build origin when coalescing: the op's `before` (and a
   * move's `order.from`) come from the FIRST op recorded for the key, never an
   * intermediate value.
   */
  private mergeWithBaseline(key: string, op: ChangeOp): ChangeOp {
    const first = this.baseline.get(key)?.firstOp;
    if (!first) return op;
    const merged: ChangeOp = { ...op, before: first.before ?? op.before };
    if (op.type === "moveNode" && op.order && first.order) {
      merged.order = { from: first.order.from, to: op.order.to };
    }
    return merged;
  }

  /** A key nets to no change when its normalized before equals its normalized after. */
  private isNetNoOp(op: ChangeOp): boolean {
    if (op.type === "moveNode") {
      return op.order != null && op.order.from === op.order.to;
    }
    if (op.before == null || op.after == null) return false; // structural ops never drop
    const meta = getPropertyMeta(op.property ?? "");
    const ctx = { probe: this.probe };
    const before = meta.canonical(op.before, ctx);
    const after = meta.canonical(op.after, ctx);
    return before != null && after != null && before === after;
  }
}

function safe(fn: () => void): void {
  try {
    fn();
  } catch {
    /* a DOM apply/invert must never throw into the host page */
  }
}

/** A short human label for the edits list. */
function labelOp(op: ChangeOp): string {
  switch (op.type) {
    case "setStyle":
      return `${op.property ?? "style"} ${op.before ?? "?"}→${op.after ?? "?"}`;
    case "setText":
      return `text "${trunc(op.after ?? "")}"`;
    case "moveNode":
      return op.order ? `move ${op.order.from}→${op.order.to}` : "move";
    case "setVisibility":
      return op.after === "hidden" ? "hide" : "show";
    case "setAttr":
      return `${op.property ?? "attr"} ${op.after ?? "?"}`;
    default:
      return op.type;
  }
}

function trunc(s: string, max = 24): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}
