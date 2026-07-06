/**
 * Marker diff (live comment sync) — the pure half of "pins update without a
 * manual refresh".
 *
 * The overlay loads the preview's comments once at mount and is otherwise
 * write-only, so a pin created by ANOTHER reviewer never appeared until a full
 * page reload. The controller now re-reads the comments periodically (and on tab
 * focus); this module computes what actually changed between the currently-placed
 * set and a fresh read, keyed by the stable per-preview comment `number`, so the
 * controller can apply a minimal update instead of clearing and repainting every
 * pin (which would flicker and could clobber the reviewer's own optimistic pin
 * or a thread popover they are reading).
 *
 * Pure + DOM-free so the reconciliation is unit-tested without a browser.
 */
import type { ExistingCommentMarker } from "../core/types.js";

export interface MarkerDiff {
  /** Comments present in the fresh read but not currently placed — new pins. */
  added: ExistingCommentMarker[];
  /** Numbers currently placed but gone from the fresh read — deleted threads. */
  removedNumbers: number[];
  /**
   * Comments present in BOTH whose displayed content changed (status/note/kind or
   * stale-ness) — the pin is restyled / its popover content refreshed in place.
   */
  updated: ExistingCommentMarker[];
}

/**
 * Diff two comment sets by `number`. `prev` is what the controller last placed;
 * `next` is a fresh read. Only fields that affect what the reviewer SEES (the pin
 * treatment + popover body) count as an update, so an unrelated re-read is a no-op.
 */
export function diffMarkersByNumber(
  prev: readonly ExistingCommentMarker[],
  next: readonly ExistingCommentMarker[],
): MarkerDiff {
  const prevByNumber = new Map<number, ExistingCommentMarker>();
  for (const c of prev) prevByNumber.set(c.number, c);
  const nextNumbers = new Set<number>();
  for (const c of next) nextNumbers.add(c.number);

  const added: ExistingCommentMarker[] = [];
  const updated: ExistingCommentMarker[] = [];
  for (const c of next) {
    const before = prevByNumber.get(c.number);
    if (!before) added.push(c);
    else if (markerContentChanged(before, c)) updated.push(c);
  }

  const removedNumbers: number[] = [];
  for (const c of prev) {
    if (!nextNumbers.has(c.number)) removedNumbers.push(c.number);
  }

  return { added, removedNumbers, updated };
}

/** Whether anything the reviewer sees on the pin / in its popover changed. */
function markerContentChanged(
  a: ExistingCommentMarker,
  b: ExistingCommentMarker,
): boolean {
  return (
    a.isStale !== b.isStale ||
    a.content.status !== b.content.status ||
    a.content.note !== b.content.note ||
    a.content.kind !== b.content.kind
  );
}
