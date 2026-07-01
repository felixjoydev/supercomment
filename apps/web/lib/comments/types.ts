/**
 * Dashboard-facing comment view model. This is the shape the realtime list
 * works with: a normalized projection of the `comments` table row (snake_case
 * in the DB) onto a stable camelCase view object the UI + pure helpers share.
 *
 * Kept dependency-free (no DOM, no Supabase) so the merge/sort/filter logic is
 * unit-testable in a node env.
 */

import type {
  Intent,
  Severity,
  TrustLevel,
  CommentStatus,
  CaptureFidelity,
  CapturedContext,
  CommentKind,
} from "@supercomment/shared";

/** Latest "Send to Claude" queue state for a comment (null = never sent). */
export type SendStatus = "pending" | "working" | "done" | "failed";

export interface CommentView {
  id: string;
  previewId: string;
  number: number;
  author: string | null;
  trustLevel: TrustLevel;
  intent: Intent;
  severity: Severity;
  note: string;
  status: CommentStatus;
  fidelity: CaptureFidelity;
  /** `comment` (ordinary) or `template` (carries a visual change-set), R11. */
  kind: CommentKind;
  /** True when re-anchoring could not resolve the element on the live deploy (R13). */
  isStale: boolean;
  context: CapturedContext | null;
  path: string | null;
  resolvedSummary: string | null;
  createdAt: string;
  /**
   * Persisted "Send to Claude" status from comment_queue, hydrated server-side
   * so the button survives a page refresh. Null when the comment was never
   * enqueued (or for realtime-delivered rows, which carry no queue join).
   */
  sendStatus: SendStatus | null;
}

/**
 * Raw `comments` row as returned by Supabase (REST select or the broadcast
 * trigger payload). All snake_case; some fields nullable. We normalize this to
 * a CommentView with `toCommentView`.
 */
export interface CommentRow {
  id: string;
  preview_id: string;
  number: number;
  author_participant?: string | null;
  author_name?: string | null;
  trust_level: TrustLevel;
  intent: Intent;
  severity: Severity;
  note: string;
  status: CommentStatus;
  fidelity?: CaptureFidelity | null;
  /** Present once migration 0026 adds the column (U3); defaults to `comment`. */
  kind?: CommentKind | null;
  is_stale?: boolean | null;
  context?: unknown;
  path?: string | null;
  resolved_summary?: string | null;
  created_at: string;
}
