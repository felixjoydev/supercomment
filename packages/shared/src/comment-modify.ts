/**
 * The author's edit/delete gate (comment edit/delete, 0050). A comment's author
 * may edit or delete their OWN comment only while it is "untouched by others":
 * open, no replies, and never sent to the agent. Once anyone else engages (a
 * reply, a send-to-agent, or a resolve/dismiss), the original is frozen and the
 * author continues via replies.
 *
 * This is the CLIENT-side show/hide + explain mirror of the server RPC checks
 * (`edit_review_comment` / the broadened `delete_review_thread`); the RPCs stay
 * the authority. Shared by the overlay and the dashboard so both surfaces gate
 * identically, and unit-testable in isolation. `lockReason` lets the UI show
 * WHY a locked-but-own comment can't be edited/deleted instead of silently
 * hiding the option (a fail-after-click is worse than an explained lock).
 */

/** Why the author can't edit/delete their own comment (null = not locked / not theirs). */
export type CommentModifyLock = "closed" | "sent" | "replied" | null;

export interface CommentModifySignals {
  /** Is the current viewer the comment's author? */
  isOwn: boolean;
  /** Comment status: `open` | `resolved` | `dismissed`. */
  status: string;
  /** Any reply exists on the thread. */
  hasReplies: boolean;
  /** The comment has been sent to the agent (a comment_queue row exists). */
  isSent: boolean;
}

/**
 * Resolve whether the author may edit/delete, and if not (but it IS theirs), the
 * reason. Priority: closed (most terminal) → sent → replied. A comment that is
 * not the viewer's returns `{ canModify: false, lockReason: null }` (nothing to
 * show, not a lock to explain).
 */
export function commentModifyGate(s: CommentModifySignals): {
  canModify: boolean;
  lockReason: CommentModifyLock;
} {
  if (!s.isOwn) return { canModify: false, lockReason: null };
  if (s.status !== "open") return { canModify: false, lockReason: "closed" };
  if (s.isSent) return { canModify: false, lockReason: "sent" };
  if (s.hasReplies) return { canModify: false, lockReason: "replied" };
  return { canModify: true, lockReason: null };
}

/** Short human phrase for a lock reason (the "why can't I edit/delete" hint). */
export function modifyLockLabel(reason: CommentModifyLock): string {
  switch (reason) {
    case "closed":
      return "This comment is closed.";
    case "sent":
      return "Already sent to the agent.";
    case "replied":
      return "Someone has replied.";
    default:
      return "";
  }
}
