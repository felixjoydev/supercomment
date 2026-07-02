/**
 * The ephemeral-preview registry for the visual editor.
 *
 * Requirement decision (baked in): "Previews are ephemeral. Edits apply visually
 * while editing but are reverted on close/discard … Track ALL previews applied
 * during the session and revert them on close, not just the current element's."
 *
 * The {@link EditSession} owns the durable ops (the change-set). This owns the
 * matching DOM-revert closures, so the controller can undo the last edit, revert
 * one edit, or reset the whole page — across every element touched in the
 * session, not just the panel's current target. It lives on the controller (like
 * the EditSession) so it survives re-targeting, mode churn, and Esc.
 *
 * Entries are keyed by the SAME `opKey` the EditSession coalesces on, so the two
 * stay in lockstep: the FIRST revert registered for a key wins (it captured the
 * developer's original pre-edit state — a later same-property nudge must still
 * revert all the way back to the build), and undo/revert operate on whichever op
 * the buffer considers last/current. Holds no DOM types itself — just thunks —
 * so it is unit-testable without a browser. Reverts never throw.
 */
export interface PreviewEntry {
  /** The coalescing key (matches `opKey`), so this pairs with a buffered op. */
  key: string;
  /** Restore the element's pre-edit DOM state for this preview. */
  revert: () => void;
}

export class PreviewLog {
  /** Applied previews in apply order; the last is the most recent distinct edit. */
  private readonly entries: PreviewEntry[] = [];
  private readonly seen = new Set<string>();

  /**
   * Register a preview's revert. First-write-wins per key: a repeated edit of the
   * same target+property reuses the ORIGINAL revert (captured against the build),
   * so a full revert lands back on the developer's value — never an intermediate.
   */
  add(key: string, revert: () => void): void {
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.entries.push({ key, revert });
  }

  /** True when a preview for this key is registered. */
  has(key: string): boolean {
    return this.seen.has(key);
  }

  /** Number of distinct previews currently applied. */
  get size(): number {
    return this.entries.length;
  }

  /**
   * Revert + drop the most recently applied preview; returns its key (or null
   * when empty). Drives the footer Undo together with `EditSession.undoLast()`.
   */
  undoLast(): string | null {
    const entry = this.entries.pop();
    if (!entry) return null;
    this.seen.delete(entry.key);
    safeRevert(entry);
    return entry.key;
  }

  /** Revert + drop the preview for a specific key (no-op when absent). */
  revertKey(key: string): void {
    const idx = this.entries.findIndex((e) => e.key === key);
    if (idx < 0) return;
    const [entry] = this.entries.splice(idx, 1);
    if (!entry) return;
    this.seen.delete(entry.key);
    safeRevert(entry);
  }

  /**
   * Revert every applied preview (LIFO, so nested/dependent changes unwind
   * cleanly) and clear. Used on editor close/discard and after a saved submit.
   */
  revertAll(): void {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const entry = this.entries[i];
      if (entry) safeRevert(entry);
    }
    this.entries.length = 0;
    this.seen.clear();
  }
}

function safeRevert(entry: PreviewEntry): void {
  try {
    entry.revert();
  } catch {
    /* a preview revert must never throw into the host page */
  }
}
