/**
 * Pure list logic for the realtime comment dashboard: merge-by-id+dedup of
 * broadcast deliveries, default-view selection, sorting, filtering/grouping,
 * status transitions, and the R23 guest-confirm gate.
 *
 * Everything here is dependency-free (no DOM, no Supabase client) so it can be
 * exhaustively unit-tested in a node env. The UI is a thin shell over these.
 */

import type { CommentStatus, Severity } from "@supercomment/shared";
import type { CommentView } from "./types";

export type DashboardFilter = "open" | "history" | "all";

/**
 * Review priority of each severity (lower = shown first). The shared contract
 * defines the severity enum (critical|important|minor) but not an ordering, so
 * the dashboard owns it here.
 */
const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  important: 1,
  minor: 2,
};

/**
 * Merge a freshly-delivered comment into the current list.
 *
 * - New id  → appended.
 * - Existing id → replaced in place (status/notes/etc. updated).
 * - Re-delivery of an identical row → no-op (dedup; idempotent).
 *
 * Returns a NEW array when something changed, otherwise the SAME reference so
 * callers can skip re-renders cheaply.
 */
export function mergeComment(
  current: readonly CommentView[],
  incoming: CommentView,
): CommentView[] {
  const idx = current.findIndex((c) => c.id === incoming.id);

  if (idx === -1) {
    return [...current, incoming];
  }

  const existing = current[idx]!;
  if (shallowEqualComment(existing, incoming)) {
    return current as CommentView[];
  }

  const next = current.slice();
  next[idx] = incoming;
  return next;
}

/**
 * Merge a batch of incoming comments, deduping by id (last write wins within
 * the batch) and preserving idempotency across re-deliveries.
 */
export function mergeComments(
  current: readonly CommentView[],
  incoming: readonly CommentView[],
): CommentView[] {
  let acc: CommentView[] = current as CommentView[];
  for (const c of incoming) {
    acc = mergeComment(acc, c);
  }
  return acc;
}

function shallowEqualComment(a: CommentView, b: CommentView): boolean {
  return (
    a.id === b.id &&
    a.number === b.number &&
    a.status === b.status &&
    a.note === b.note &&
    a.intent === b.intent &&
    a.severity === b.severity &&
    a.trustLevel === b.trustLevel &&
    a.author === b.author &&
    a.resolvedSummary === b.resolvedSummary &&
    a.fidelity === b.fidelity &&
    a.path === b.path &&
    a.createdAt === b.createdAt
  );
}

/**
 * Default review ordering: most severe first, then newest first. Stable for
 * ties by descending comment number (newest number wins).
 */
export function sortForReview(comments: readonly CommentView[]): CommentView[] {
  return comments.slice().sort((a, b) => {
    const sev = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (sev !== 0) return sev;
    const t = timeOf(b.createdAt) - timeOf(a.createdAt);
    if (t !== 0) return t;
    return b.number - a.number;
  });
}

function timeOf(iso: string): number {
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

export function isOpen(c: CommentView): boolean {
  return c.status === "open";
}

export function isHistory(c: CommentView): boolean {
  return c.status === "resolved" || c.status === "dismissed";
}

/**
 * Apply a dashboard filter:
 *  - "open"    → only open comments (the default view).
 *  - "history" → resolved + dismissed.
 *  - "all"     → everything.
 */
export function filterComments(
  comments: readonly CommentView[],
  filter: DashboardFilter,
): CommentView[] {
  switch (filter) {
    case "open":
      return comments.filter(isOpen);
    case "history":
      return comments.filter(isHistory);
    case "all":
    default:
      return comments.slice();
  }
}

/**
 * The default dashboard view = open comments, sorted for review. Resolved and
 * dismissed are excluded here (they live behind the "history" filter).
 */
export function selectDefaultView(comments: readonly CommentView[]): CommentView[] {
  return sortForReview(filterComments(comments, "open"));
}

/**
 * The full pipeline a view uses: filter then sort. Centralized so the UI never
 * re-implements ordering.
 */
export function selectView(
  comments: readonly CommentView[],
  filter: DashboardFilter,
): CommentView[] {
  return sortForReview(filterComments(comments, filter));
}

export interface StatusCounts {
  open: number;
  resolved: number;
  dismissed: number;
  total: number;
}

export function countByStatus(comments: readonly CommentView[]): StatusCounts {
  const counts: StatusCounts = { open: 0, resolved: 0, dismissed: 0, total: comments.length };
  for (const c of comments) {
    if (c.status === "open") counts.open += 1;
    else if (c.status === "resolved") counts.resolved += 1;
    else if (c.status === "dismissed") counts.dismissed += 1;
  }
  return counts;
}

/**
 * Apply a lifecycle transition to a comment in the list (used for optimistic
 * UI before the RPC's broadcast confirms it). Pure: returns a new list.
 */
export function applyStatusTransition(
  comments: readonly CommentView[],
  commentId: string,
  status: CommentStatus,
  summary?: string | null,
): CommentView[] {
  const idx = comments.findIndex((c) => c.id === commentId);
  if (idx === -1) return comments as CommentView[];
  const next = comments.slice();
  next[idx] = {
    ...comments[idx]!,
    status,
    resolvedSummary: summary ?? comments[idx]!.resolvedSummary,
  };
  return next;
}

// ---------------------------------------------------------------------------
// R23 — guest-comment trust gating for "Send to Claude".
// ---------------------------------------------------------------------------

/**
 * Guest-authored comments are UNTRUSTED to the agent. They must NOT be enqueued
 * to Claude without an explicit human confirmation. Member comments may be sent
 * directly.
 *
 * `requiresConfirm` is true exactly when the comment is from a guest. The UI
 * shows a confirm step; the API double-checks via `canEnqueue`.
 */
export function requiresGuestConfirm(comment: Pick<CommentView, "trustLevel">): boolean {
  return comment.trustLevel === "guest";
}

/**
 * Decide whether an enqueue request is permitted given the comment's trust
 * level and whether the caller supplied explicit confirmation.
 *
 * - member comment            → always allowed.
 * - guest comment + confirmed  → allowed.
 * - guest comment, NOT confirmed → BLOCKED (needs confirm).
 */
export function canEnqueue(
  comment: Pick<CommentView, "trustLevel">,
  confirmed: boolean,
): { ok: true } | { ok: false; reason: "guest_confirm_required" } {
  if (!requiresGuestConfirm(comment)) return { ok: true };
  return confirmed ? { ok: true } : { ok: false, reason: "guest_confirm_required" };
}

// ---------------------------------------------------------------------------
// Phase 2 — send-to-agent per-member permission.
// ---------------------------------------------------------------------------

/**
 * Whether to SHOW the per-comment "Send to agent" button: the current user must
 * be able to mutate (a workspace member reached this RLS-scoped page) AND hold
 * the send-to-agent grant. UX only — /api/send-to-claude re-enforces the grant.
 */
export function canShowSendButton(opts: {
  canMutate: boolean;
  canSendToAgent: boolean;
}): boolean {
  return opts.canMutate === true && opts.canSendToAgent === true;
}

/**
 * The server-side enqueue authorization decision (mirrors the gate in
 * /api/send-to-claude): the caller must be a workspace member (guests are never
 * members on this path) AND be granted send-to-agent. Returns the 403 reason
 * otherwise. The route composes `requireMember` (which also yields 401/anon) with
 * the `can_user_send_to_agent` RPC; this captures the send-to-agent layer.
 */
export function authorizeSendToAgent(opts: {
  isMember: boolean;
  canSendToAgent: boolean;
}):
  | { ok: true }
  | { ok: false; status: 403; reason: "not_member" | "send_to_agent_forbidden" } {
  if (!opts.isMember) return { ok: false, status: 403, reason: "not_member" };
  if (!opts.canSendToAgent) {
    return { ok: false, status: 403, reason: "send_to_agent_forbidden" };
  }
  return { ok: true };
}
