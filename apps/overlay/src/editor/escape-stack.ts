/**
 * U2 — the controller-owned Escape layer stack.
 *
 * Escape must cancel only the INNERMOST active layer, not tear everything down at
 * once: pressing Escape while inline-editing text should end the text edit and
 * leave the panel open, not close the whole editor. Layers register with a
 * priority; on Escape the highest-priority active layer closes and the event is
 * consumed. Later units register their own layers (gesture, picker) here rather
 * than re-deriving Escape semantics in each controller path.
 *
 * Pure and dependency-free (holds only thunks), so it is unit-testable without a
 * browser. `close()` is best-effort and never throws into the host page.
 */
export interface EscapeLayer {
  /** Higher = more inner (closed first). Use {@link ESCAPE_PRIORITY}. */
  readonly priority: number;
  /** Is this layer currently active (i.e. something to cancel)? */
  isActive(): boolean;
  /** Cancel just this layer. */
  close(): void;
}

/** Canonical layer ordering (inner → outer), matching the plan's Escape stack. */
export const ESCAPE_PRIORITY = {
  inlineText: 50,
  gesture: 40,
  popover: 30,
  panelForm: 20,
  selection: 10,
} as const;

export class EscapeStack {
  private layers: EscapeLayer[] = [];

  /** Register a layer; returns an unregister thunk (call it in teardown). */
  register(layer: EscapeLayer): () => void {
    this.layers.push(layer);
    return () => {
      this.layers = this.layers.filter((l) => l !== layer);
    };
  }

  /**
   * Close the innermost active layer. Returns true when a layer handled the
   * Escape (so the caller can stop), false when nothing was active.
   */
  handle(): boolean {
    let inner: EscapeLayer | null = null;
    for (const layer of this.layers) {
      let active = false;
      try {
        active = layer.isActive();
      } catch {
        active = false;
      }
      if (active && (inner === null || layer.priority > inner.priority)) inner = layer;
    }
    if (!inner) return false;
    try {
      inner.close();
    } catch {
      /* closing a layer must never throw into the host page */
    }
    return true;
  }
}
