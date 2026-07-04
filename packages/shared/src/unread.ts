/**
 * Per-viewer, thread-aware unread derivation, shared by the dashboard and the
 * overlay so both compute unread identically.
 *
 * A thread is unread for a viewer when there is no read receipt, or the latest
 * activity happened after the receipt:
 *   max(createdAt, statusChangedAt, latestReplyAt) > lastReadAt
 * statusChangedAt (0037) makes a reopen re-flag; latestReplyAt makes a new reply
 * re-flag. The viewer's own thread is seeded read server-side (seed_author_read),
 * so authorship is not re-checked here.
 */
export interface UnreadInputs {
  /** The root comment's created_at (ISO). */
  createdAt: string;
  /** When the comment's status last changed (ISO), if known. */
  statusChangedAt?: string | null;
  /** The newest reply's created_at (ISO), if any. */
  latestReplyAt?: string | null;
  /** The viewer's receipt (ISO); null/undefined = never read = unread. */
  lastReadAt?: string | null;
}

function ms(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

/** True when the thread has activity the viewer has not seen. */
export function isThreadUnread(input: UnreadInputs): boolean {
  if (!input.lastReadAt) return true;
  const read = ms(input.lastReadAt);
  if (read === 0) return true;
  const activity = Math.max(
    ms(input.createdAt),
    ms(input.statusChangedAt),
    ms(input.latestReplyAt),
  );
  return activity > read;
}
