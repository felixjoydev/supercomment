import { z } from "zod";
import {
  intentSchema,
  severitySchema,
  trustLevelSchema,
  commentStatusSchema,
  captureFidelitySchema,
  commentKindSchema,
  commentLaneSchema,
} from "./enums.js";
import { capturedContextSchema } from "./change-set.js";

// ---------------------------------------------------------------------------
// Author
// ---------------------------------------------------------------------------

/** Cosmetic display name + authoritative trust level of a comment author. */
export const commentAuthorSchema = z.object({
  displayName: z.string().min(1),
  trustLevel: trustLevelSchema,
});
export type CommentAuthor = z.infer<typeof commentAuthorSchema>;

// ---------------------------------------------------------------------------
// Comment (persisted shape / DB row)
// ---------------------------------------------------------------------------

/**
 * A persisted comment. `number` is the stable, per-preview, never-reused
 * sequential id allocated atomically by the guest-write RPC (R13).
 */
export const commentSchema = z.object({
  id: z.uuid(),
  previewId: z.uuid(),
  /** Stable per-preview comment number (R13). */
  number: z.number().int().positive(),
  author: commentAuthorSchema,
  intent: intentSchema,
  severity: severitySchema,
  note: z.string().min(1),
  context: capturedContextSchema,
  status: commentStatusSchema,
  fidelity: captureFidelitySchema,
  /** `comment` (ordinary) or `template` (carries a visual change-set), R11. */
  kind: commentKindSchema.default("comment"),
  /**
   * Workflow lane while open (backlog|ready_for_agent|in_review). "Done" is
   * `status='resolved'` and "Dismissed" is `status='dismissed'`, never a lane —
   * see `commentLaneSchema`. Defaults to `backlog` so existing rows/payloads
   * that predate the column stay valid.
   */
  lane: commentLaneSchema.default("backlog"),
  /**
   * The agent's short "what changed" note, recorded when a comment is promoted
   * to `in_review` (mark_comment_in_review). Shown to the reviewer on the
   * Ready-for-review card. Absent until an in_review promotion supplies one.
   */
  reviewSummary: z.string().optional(),
  /** Set when re-anchoring can no longer resolve the element on the live deploy (R13). */
  isStale: z.boolean().default(false),
  /** Who resolved/dismissed it (member user id), when applicable. */
  resolvedBy: z.uuid().optional(),
  /** Optional summary the agent/dev recorded on resolution. */
  resolvedSummary: z.string().optional(),
  createdAt: z.iso.datetime(),
});
export type Comment = z.infer<typeof commentSchema>;

// ---------------------------------------------------------------------------
// New comment input (overlay -> RPC payload)
// ---------------------------------------------------------------------------

/**
 * The payload the overlay sends to create a comment. The server allocates
 * `id`, `number`, `status`, `createdAt`, and the authoritative `trustLevel`;
 * the client only proposes a display name and the captured content.
 */
export const newCommentInputSchema = z.object({
  previewId: z.uuid(),
  /** Cosmetic author display name (trust level is decided server-side). */
  authorDisplayName: z.string().min(1),
  intent: intentSchema,
  severity: severitySchema,
  note: z.string().min(1),
  context: capturedContextSchema,
  fidelity: captureFidelitySchema.default("live"),
  /**
   * `template` for a visual-edit comment; omitted for an ordinary comment
   * (the server defaults the persisted column to `comment`), R11.
   */
  kind: commentKindSchema.optional(),
});
export type NewCommentInput = z.infer<typeof newCommentInputSchema>;

