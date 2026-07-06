/**
 * Realtime broadcast reducer for the dashboard comment board.
 *
 * The board subscribes to the per-preview private channel `preview:<id>` and
 * receives `realtime.broadcast_changes` deliveries (migrations 0004 + 0038):
 *   - comments      INSERT / UPDATE / DELETE
 *   - comment_replies INSERT / DELETE
 * All arrive on the SAME topic, distinguished by the payload's `table`. This is
 * the pure reducer the board's channel handlers feed each delivery through, kept
 * DOM- and Supabase-free so it is exhaustively unit-testable in node.
 *
 * Two bugs this fixes vs. the old inline handler, which ran EVERY delivery through
 * `toCommentView`:
 *   - a `comment_replies` row has no `number`/`note`/`status`, so it projected to
 *     a blank comment and was appended as a PHANTOM card. Replies are now re-keyed
 *     off `comment_id` onto their PARENT (0038's intent) and never become a row.
 *   - DELETE was never handled, so a thread deleted by one viewer lingered on
 *     another's board until refresh. It now drops.
 */
import { isThreadUnread } from "@supercomment/shared";

import { toCommentView } from "./transform";
import { mergeComment, reconcileUnread } from "./view";
import type { CommentRow, CommentView } from "./types";

/** The DB operation a delivery represents (the broadcast event name the channel matched). */
export type BroadcastOp = "INSERT" | "UPDATE" | "DELETE";

/** The `broadcast_changes` body we consume; every field read defensively. */
interface BroadcastChange {
  table: string | null;
  record: Record<string, unknown> | null;
  oldRecord: Record<string, unknown> | null;
}

const REPLIES_TABLE = "comment_replies";

/**
 * Pull the `broadcast_changes` body out of a raw realtime message payload,
 * tolerating an extra `{ payload }` nesting some protocol/client versions add.
 */
export function readBroadcastChange(payload: unknown): BroadcastChange | null {
  if (!payload || typeof payload !== "object") return null;
  let body = payload as Record<string, unknown>;
  if (
    body.table === undefined &&
    body.record === undefined &&
    body.old_record === undefined &&
    body.payload &&
    typeof body.payload === "object"
  ) {
    body = body.payload as Record<string, unknown>;
  }
  return {
    table: typeof body.table === "string" ? body.table : null,
    record: asRow(body.record),
    oldRecord: asRow(body.old_record),
  };
}

function asRow(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

/**
 * Apply one realtime broadcast to the comment list. Pure; returns a NEW array
 * only when something changed (the same reference otherwise, so the caller can
 * skip a re-render). `operation` is the broadcast event name the channel matched.
 */
export function applyBroadcast(
  current: readonly CommentView[],
  payload: unknown,
  operation: BroadcastOp,
): CommentView[] {
  const change = readBroadcastChange(payload);
  if (!change) return current as CommentView[];

  // A reply is NEVER a row in the comment list — re-key it onto its parent thread.
  const row = change.record ?? change.oldRecord;
  if (change.table === REPLIES_TABLE || isReplyRow(row)) {
    return applyReplyChange(current, change, operation);
  }

  if (operation === "DELETE") {
    const id = typeof change.oldRecord?.id === "string" ? change.oldRecord.id : null;
    if (!id) return current as CommentView[];
    const next = current.filter((c) => c.id !== id);
    return next.length === current.length ? (current as CommentView[]) : next;
  }

  // INSERT / UPDATE of a comment row.
  if (!change.record || typeof change.record.id !== "string") {
    return current as CommentView[];
  }
  const incoming = toCommentView(change.record as unknown as CommentRow);
  const existing = current.find((c) => c.id === incoming.id);
  // The broadcast carries no per-viewer read receipt; preserve the viewer's read
  // state so a status/edit update never un-reads a thread already on screen.
  return mergeComment(
    current,
    existing ? reconcileUnread(existing, incoming) : incoming,
  );
}

/**
 * A reply insert/delete: bump the PARENT comment's latest-reply marker and
 * recompute its per-viewer unread, so "a new reply re-flags a read thread as
 * unread" reaches other viewers live (0038) AND an already-open thread re-fetches
 * (comment-thread keys its reply load on `latestReplyAt`). No-op when the parent
 * isn't on the board (e.g. filtered out) — the reply's own thread load will catch it.
 */
function applyReplyChange(
  current: readonly CommentView[],
  change: BroadcastChange,
  operation: BroadcastOp,
): CommentView[] {
  const row = operation === "DELETE" ? change.oldRecord : change.record;
  const commentId = typeof row?.comment_id === "string" ? row.comment_id : null;
  if (!commentId) return current as CommentView[];
  const existing = current.find((c) => c.id === commentId);
  if (!existing) return current as CommentView[];
  const replyAt = typeof row?.created_at === "string" ? row.created_at : null;

  let latestReplyAt = existing.latestReplyAt;
  if (operation === "DELETE") {
    // If the newest reply was the one removed, clear the marker so the open thread
    // re-fetches the true latest; a middle-reply delete leaves it unchanged.
    if (isoGte(replyAt, existing.latestReplyAt)) latestReplyAt = null;
  } else {
    latestReplyAt = laterIso(existing.latestReplyAt, replyAt);
  }

  const updated: CommentView = {
    ...existing,
    latestReplyAt,
    unread: isThreadUnread({
      createdAt: existing.createdAt,
      statusChangedAt: existing.statusChangedAt,
      latestReplyAt,
      lastReadAt: existing.lastReadAt,
    }),
  };
  return mergeComment(current, updated);
}

/**
 * Heuristic used ONLY when a delivery omits `table` (defensive): a reply row
 * carries a `comment_id` and, unlike a comment row, no numeric `number`.
 */
function isReplyRow(row: Record<string, unknown> | null): boolean {
  if (!row) return false;
  return typeof row.comment_id === "string" && typeof row.number !== "number";
}

/** The later of two ISO timestamps (either may be null). */
function laterIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(b) > Date.parse(a) ? b : a;
}

/** Whether ISO `a` is at or after ISO `b` (b null → true; a null → false). */
function isoGte(a: string | null, b: string | null): boolean {
  if (!b) return true;
  if (!a) return false;
  return Date.parse(a) >= Date.parse(b);
}
