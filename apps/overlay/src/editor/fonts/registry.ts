/**
 * U7 — session FontFace registry.
 *
 * Every `FontFace` the editor adds to a document during a session is tracked here
 * so it can be removed cleanly on discard / exit / destroy — the page's
 * `document.fonts` returns to its exact baseline and no preview font leaks past
 * the session (the plan's "document.fonts returns to baseline after discard").
 *
 * Tracking is keyed per document because device-mode runs edits inside child
 * iframes with their own `FontFaceSet`; `drain()` with no argument clears every
 * document, `drain(doc)` clears just one. Never throws into the host page.
 */

/** The single FontFace method the registry calls to remove a face. */
export interface RegistrableFace {
  readonly family?: string;
}

export interface FaceSetLike {
  delete(face: RegistrableFace): unknown;
}

export interface RegistryDocLike {
  readonly fonts: FaceSetLike;
}

export class FontRegistry {
  private readonly byDoc = new Map<RegistryDocLike, Set<RegistrableFace>>();

  /** Record a face added to `doc` so it can be removed later. */
  track(doc: RegistryDocLike, face: RegistrableFace): void {
    let set = this.byDoc.get(doc);
    if (!set) {
      set = new Set();
      this.byDoc.set(doc, set);
    }
    set.add(face);
  }

  /** How many faces are currently tracked (all docs, or one doc). Test helper. */
  size(doc?: RegistryDocLike): number {
    if (doc) return this.byDoc.get(doc)?.size ?? 0;
    let n = 0;
    for (const set of this.byDoc.values()) n += set.size;
    return n;
  }

  /**
   * Remove every tracked face from its document's FontFaceSet and forget it. With
   * a `doc`, drains only that document; with none, drains all (session teardown).
   * Best-effort: a delete that throws is swallowed so teardown always completes.
   */
  drain(doc?: RegistryDocLike): void {
    if (doc) {
      this.removeDoc(doc);
      this.byDoc.delete(doc);
      return;
    }
    for (const d of [...this.byDoc.keys()]) this.removeDoc(d);
    this.byDoc.clear();
  }

  private removeDoc(doc: RegistryDocLike): void {
    const set = this.byDoc.get(doc);
    if (!set) return;
    for (const face of set) {
      try {
        doc.fonts.delete(face);
      } catch {
        /* teardown is best-effort */
      }
    }
    set.clear();
  }
}
