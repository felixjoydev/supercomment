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

// The raw `comments` row shape is now the single source of truth in shared.
export type { CommentRow } from "@supercomment/shared";

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

