/**
 * Pure normalization from a raw `comments` row (DB / broadcast payload) to the
 * dashboard CommentView. No DOM, no Supabase — node-testable.
 */

import type { CapturedContext } from "@supercomment/shared";
import type { CommentRow, CommentView } from "./types";

function coerceContext(value: unknown): CapturedContext | null {
  if (value == null) return null;
  // The broadcast trigger may deliver context as a JSON string; the REST path
  // delivers it already parsed. Accept both, fail soft to null.
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? (parsed as CapturedContext) : null;
    } catch {
      return null;
    }
  }
  if (typeof value === "object") return value as CapturedContext;
  return null;
}

export function toCommentView(
  row: CommentRow,
  authorName?: string | null,
): CommentView {
  return {
    id: row.id,
    previewId: row.preview_id,
    number: row.number,
    author: authorName ?? row.author_name ?? null,
    trustLevel: row.trust_level,
    intent: row.intent,
    severity: row.severity,
    note: row.note,
    status: row.status,
    fidelity: (row.fidelity ?? "live") as CommentView["fidelity"],
    isStale: row.is_stale ?? false,
    context: coerceContext(row.context),
    path: row.path ?? null,
    resolvedSummary: row.resolved_summary ?? null,
    createdAt: row.created_at,
    // Hydrated separately from comment_queue in getCommentsForPreview; the
    // realtime/broadcast path carries no queue join, so it defaults to null.
    sendStatus: null,
  };
}
