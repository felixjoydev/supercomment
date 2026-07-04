/**
 * Pure normalization from a raw `comments` row (DB / broadcast payload) to the
 * dashboard CommentView. The snake_case→camelCase projection + context coercion
 * + defaults live in `@supercomment/shared` (normalizeCommentRow); this is the
 * thin dashboard decorator that resolves the author name/email, computes the page
 * grouping key + per-viewer unread, and defaults the send-status. No DOM, no
 * Supabase - node-testable.
 */

import { normalizeCommentRow, pageKeyOf, isThreadUnread } from "@supercomment/shared";
import type { CommentRow, CommentView } from "./types";

/**
 * Per-viewer + join extras that are not on the `comments` row itself. Absent on
 * the realtime/broadcast path (a freshly broadcast row carries no join), where a
 * new thread correctly resolves to unread until the viewer opens it.
 */
export interface CommentViewExtras {
  authorName?: string | null;
  /** Member dashboard only; never passed on the guest/agent path. */
  authorEmail?: string | null;
  latestReplyAt?: string | null;
  lastReadAt?: string | null;
}

export function toCommentView(
  row: CommentRow,
  extras?: CommentViewExtras,
): CommentView {
  const n = normalizeCommentRow(row);
  const page = pageKeyOf(n.context?.url ?? n.path ?? null);
  const latestReplyAt = extras?.latestReplyAt ?? null;
  const lastReadAt = extras?.lastReadAt ?? null;
  return {
    id: n.id,
    previewId: n.previewId,
    number: n.number,
    // Prefer the joined participant name; fall back to a broadcast-payload
    // author_name, then null.
    author: extras?.authorName ?? n.authorName ?? null,
    trustLevel: n.trustLevel,
    intent: n.intent,
    severity: n.severity,
    note: n.note,
    status: n.status,
    fidelity: n.fidelity,
    kind: n.kind,
    isStale: n.isStale,
    context: n.context,
    path: n.path,
    resolvedSummary: n.resolvedSummary,
    createdAt: n.createdAt,
    statusChangedAt: n.statusChangedAt,
    // Hydrated separately from comment_queue in getCommentsForPreview; the
    // realtime/broadcast path carries no queue join, so it defaults to null.
    sendStatus: null,
    pageKey: page.key,
    pageLabel: page.label,
    authorEmail: extras?.authorEmail ?? null,
    latestReplyAt,
    lastReadAt,
    unread: isThreadUnread({
      createdAt: n.createdAt,
      statusChangedAt: n.statusChangedAt,
      latestReplyAt,
      lastReadAt,
    }),
  };
}
