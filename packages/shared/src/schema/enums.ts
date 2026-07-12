import { z } from "zod";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/** What the reviewer wants the change to accomplish. */
export const intentSchema = z.enum(["fix", "change", "question"]);
export type Intent = z.infer<typeof intentSchema>;

/** How urgent / impactful the comment is. */
export const severitySchema = z.enum(["critical", "important", "minor"]);
export type Severity = z.infer<typeof severitySchema>;

/**
 * Trust level of the comment author. Drives the prompt-injection guard:
 * `guest` comments are never auto-included in agent "fix all" (R23).
 */
export const trustLevelSchema = z.enum(["member", "guest"]);
export type TrustLevel = z.infer<typeof trustLevelSchema>;

/** Lifecycle of a comment (R16). */
export const commentStatusSchema = z.enum(["open", "resolved", "dismissed"]);
export type CommentStatus = z.infer<typeof commentStatusSchema>;

/**
 * Whether the comment was made against the live app or an offline snapshot.
 * Snapshot-fidelity comments omit live-only React source data (R7, R12).
 */
export const captureFidelitySchema = z.enum(["live", "snapshot"]);
export type CaptureFidelity = z.infer<typeof captureFidelitySchema>;

/**
 * The device surface a comment was made on. Auto-derived from the viewport width
 * for normal comments; set explicitly by the responsive device-mode toolbar.
 * "responsive" means the reviewer is flagging a fluid/breakpoint issue rather
 * than one specific device.
 */
export const deviceSurfaceSchema = z.enum([
  "web",
  "mobile",
  "tablet",
  "responsive",
]);
export type DeviceSurface = z.infer<typeof deviceSurfaceSchema>;

/**
 * The kind of comment. `comment` is an ordinary text/annotation comment;
 * `template` is a visual-edit comment that carries a `context.changeSet` of
 * direct manipulations and can be re-applied across pages of the same build.
 * A background discriminator surfaced to the dashboard + MCP for differentiation
 * (R11). Defaults to `comment` so existing rows/payloads are unaffected.
 */
export const commentKindSchema = z.enum(["comment", "template"]);
export type CommentKind = z.infer<typeof commentKindSchema>;

/**
 * Workflow lane of an OPEN comment — a Kanban-style pipeline, NOT a topic
 * taxonomy (bug/design/copy). Everything starts in `backlog`; a member hands it
 * to the agent's work queue (`ready_for_agent`), and once the dev approves the
 * agent's change it moves to `in_review`. THREE values, not four: "Done" is not
 * a lane, it is `status='resolved'`, and "Dismissed" is `status='dismissed'` —
 * both live on `status`, so the lane column can never disagree with them. Only
 * meaningful while `status='open'`. Defaults to `backlog` so every existing row
 * stays valid.
 */
export const commentLaneSchema = z.enum([
  "backlog",
  "ready_for_agent",
  "in_review",
]);
export type CommentLane = z.infer<typeof commentLaneSchema>;

