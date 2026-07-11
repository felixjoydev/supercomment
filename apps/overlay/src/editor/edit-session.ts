/**
 * U9 — the edit-session buffer, now a thin FACADE over the {@link HistoryEngine}.
 *
 * The in-progress set of visual edits a reviewer is authoring, held INDEPENDENT
 * of selection mode and the live DOM. Since U3 the authoritative structure is the
 * history engine (which owns the coalescing tip map, the first-write-wins
 * baseline, and undo/redo); this class keeps the buffer's public API
 * (record/remove/has/undoLast/size/isEmpty/list/toChangeSet/discard) so the
 * controller's submit contract and the panel tests are untouched.
 *
 * The submit path folds `toChangeSet()` into `context.changeSet`; the controller
 * drives real undo/redo, gestures, per-edit revert, and Discard-all directly on
 * `history`. A bare `record(op)` (no DOM closures) is a buffer-only path used by
 * tests and any caller that only cares about the projection.
 */
import type { ChangeOp, VisualChangeSet } from "@supercomment/shared";

import { opKey } from "./op-key.js";
import { HistoryEngine, type EditDom } from "./history.js";
import type { ColorProbe } from "./color/normalize.js";

export { opKey };

const NOOP_DOM: EditDom = {
  apply: () => {},
  invert: () => {},
  revertToBuild: () => {},
};

export class EditSession {
  /** The authoritative history engine; the controller drives it directly. */
  readonly history: HistoryEngine;

  /** @param authoredCommit build the edits are authored against (drift guard). */
  constructor(authoredCommit?: string, opts: { probe?: ColorProbe } = {}) {
    this.history = new HistoryEngine({ authoredCommit, probe: opts.probe });
  }

  /** Record (or update) one edit into the buffer with no DOM effect (facade path). */
  record(op: ChangeOp): void {
    this.history.record(op, NOOP_DOM);
  }

  /** Remove a recorded edit (per-edit revert). */
  remove(op: ChangeOp): void {
    this.history.revertKey(opKey(op));
  }

  /** True when an op with this logical key is currently buffered. */
  has(op: ChangeOp): boolean {
    return this.history.hasKey(opKey(op));
  }

  /** Undo the most-recent recorded step; returns the primary op undone (or null). */
  undoLast(): ChangeOp | null {
    return this.history.undo();
  }

  /** True when nothing nets to a change. */
  isEmpty(): boolean {
    return this.history.isEmpty();
  }

  /** Number of distinct edits currently in the net change-set. */
  get size(): number {
    return this.history.size;
  }

  /** The net ops, in insertion order. */
  list(): ChangeOp[] {
    return this.history.projectOps();
  }

  /** Throw away all in-progress edits and reset the page to build (non-undoable). */
  discard(): void {
    this.history.resetToBuild();
  }

  /** The change-set to fold into `context.changeSet`, or null when empty. */
  toChangeSet(): VisualChangeSet | null {
    return this.history.toChangeSet();
  }
}
