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
  CommentLane,
} from "@supercomment/shared";

// The raw `comments` row shape is now the single source of truth in shared.
export type { CommentRow } from "@supercomment/shared";

export interface CommentView {
  id: string;
  previewId: string;
  number: number;
  author: string | null;
  /** The authoring participant id (for member-only guest-email edit, U8). */
  authorParticipant: string | null;
  trustLevel: TrustLevel;
  intent: Intent;
  severity: Severity;
  note: string;
  status: CommentStatus;
  fidelity: CaptureFidelity;
  /** `comment` (ordinary) or `template` (carries a visual change-set), R11. */
  kind: CommentKind;
  /**
   * Workflow lane while OPEN (backlog|ready_for_agent|in_review). The DISPLAYED
   * lane is a projection (`displayLane`): a resolved comment shows "done" and a
   * dismissed one "dismissed", regardless of this value — so lane never
   * disagrees with status. Rides the comments-row broadcast, so it stays live.
   */
  lane: CommentLane;
  /**
   * The agent's short "what changed" note, set when a comment was promoted to
   * in_review (mark_comment_in_review). Shown to the reviewer on the
   * Ready-for-review card. Null when none was recorded.
   */
  reviewSummary: string | null;
  /** True when re-anchoring could not resolve the element on the live deploy (R13). */
  isStale: boolean;
  context: CapturedContext | null;
  path: string | null;
  resolvedSummary: string | null;
  createdAt: string;
  /** When status last changed (0037); feeds thread-aware unread on reopen. */
  statusChangedAt: string | null;
  /** Normalized page identity for grouping (pageKeyOf(context.url)). */
  pageKey: string;
  /** Human label for the page group (path, or "Home" / "Other"). */
  pageLabel: string;
  /**
   * The guest author's email (member dashboard only; null for members or when
   * not captured). NEVER surfaced to guests or the agent.
   */
  authorEmail: string | null;
  /** Newest reply's created_at, if any (feeds unread). */
  latestReplyAt: string | null;
  /** The current viewer's read receipt for this thread (null = never read). */
  lastReadAt: string | null;
  /** Per-viewer thread-aware unread, derived from the three timestamps above. */
  unread: boolean;
  /**
   * Member-only private instruction for the agent (agent_prompts, U2/U4).
   * Null when no member has written one, OR when one was written and then
   * cleared (an empty save deletes the row — both collapse to the same
   * zero-rows state, see 0043_agent_prompt.sql). NEVER surfaced to guests;
   * hydrated on initial load in getCommentsForPreview, kept live via
   * onLocalUpdate after an in-session edit.
   */
  privatePrompt: {
    body: string;
    authorDisplayName: string;
    /** Attached image refs (`captures` paths, 0049); signed on read for display. */
    imageRefs: string[];
  } | null;
}

