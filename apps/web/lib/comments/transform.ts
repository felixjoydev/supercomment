/**
 * Pure normalization from a raw `comments` row (DB / broadcast payload) to the
 * dashboard CommentView. The snake_case→camelCase projection + context coercion
 * + defaults live in `@supercomment/shared` (normalizeCommentRow); this is the
 * thin dashboard decorator that resolves the author name and defaults the
 * send-status. No DOM, no Supabase — node-testable.
 */

import { normalizeCommentRow } from "@supercomment/shared";
import type { CommentRow, CommentView } from "./types";

export function toCommentView(
  row: CommentRow,
  authorName?: string | null,
): CommentView {
  const n = normalizeCommentRow(row);
  return {
    id: n.id,
    previewId: n.previewId,
    number: n.number,
    // Prefer the joined participant name; fall back to a broadcast-payload
    // author_name, then null.
    author: authorName ?? n.authorName ?? null,
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
    // Hydrated separately from comment_queue in getCommentsForPreview; the
    // realtime/broadcast path carries no queue join, so it defaults to null.
    sendStatus: null,
  };
}
