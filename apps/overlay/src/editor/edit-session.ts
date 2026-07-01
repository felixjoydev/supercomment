/**
 * U9 — the edit-session buffer.
 *
 * The in-progress set of visual edits a reviewer is authoring, held INDEPENDENT
 * of selection mode and the live DOM. This is the editor's state model: the
 * content/style/structural edit units (U10–U12) record ops into it, and submit
 * (U13) folds `toChangeSet()` into `context.changeSet`.
 *
 * Why a standalone object (G13/R7): switching selection mode or pressing Esc
 * clears the SELECTION, but must NOT discard in-progress edits — the controller
 * keeps this session across that churn. Edits are private to the reviewer until
 * they explicitly save; `discard()` throws them away.
 *
 * Coalescing: re-editing the same target+property UPDATES in place rather than
 * appending, and the ORIGINAL before-value is preserved across successive edits
 * (so the change-set reflects "developer's build → desired", never an
 * intermediate value). An edit whose value returns to its original is dropped
 * entirely (a net no-op leaves no trace). Structural inserts never coalesce
 * (each new node is distinct).
 */
import type { ChangeOp, VisualChangeSet } from "@supercomment/shared";

/**
 * A stable key for "the same logical edit". Style/text/attr/remove/move/
 * visibility ops coalesce by target + property + breakpoint + state; every
 * `insertNode` is distinct (keyed by its opId) since each is a new node.
 */
export function opKey(op: ChangeOp): string {
  const t = op.target;
  const targetId = t.source
    ? `${t.source.file}:${t.source.line}:${t.source.column}`
    : t.selector;
  if (op.type === "insertNode") {
    return `insertNode|${op.opId}`;
  }
  return [
    op.type,
    targetId,
    op.property ?? "",
    op.responsive ?? "base",
    op.state ?? "default",
  ].join("|");
}

export class EditSession {
  private readonly ops = new Map<string, ChangeOp>();
  private readonly authoredCommit?: string;

  /** @param authoredCommit build the edits are authored against (drift guard). */
  constructor(authoredCommit?: string) {
    this.authoredCommit = authoredCommit;
  }

  /**
   * Record (or update) one edit. Re-editing the same target+property preserves
   * the original before-value and updates the after-value; a value that returns
   * to its original drops the edit entirely.
   */
  record(op: ChangeOp): void {
    const key = opKey(op);
    const existing = this.ops.get(key);
    const merged: ChangeOp = existing
      ? { ...op, before: existing.before }
      : op;

    // Net no-op: a VALUE edit (before + after both present) that ends where it
    // started leaves no trace. Structural ops (before/after absent) are exempt.
    if (
      merged.before != null &&
      merged.after != null &&
      merged.before === merged.after
    ) {
      this.ops.delete(key);
      return;
    }
    this.ops.set(key, merged);
  }

  /** Remove a recorded edit (the reviewer reverted this one change). */
  remove(op: ChangeOp): void {
    this.ops.delete(opKey(op));
  }

  /** True when nothing has been edited yet. */
  isEmpty(): boolean {
    return this.ops.size === 0;
  }

  /** Number of distinct edits currently recorded. */
  get size(): number {
    return this.ops.size;
  }

  /** The recorded ops, in insertion order. */
  list(): ChangeOp[] {
    return [...this.ops.values()];
  }

  /** Throw away all in-progress edits (explicit discard). */
  discard(): void {
    this.ops.clear();
  }

  /**
   * The change-set to fold into `context.changeSet` at submit, or `null` when
   * there is nothing to save.
   */
  toChangeSet(): VisualChangeSet | null {
    if (this.ops.size === 0) {
      return null;
    }
    return {
      ...(this.authoredCommit ? { authoredCommit: this.authoredCommit } : {}),
      ops: this.list(),
    };
  }
}
