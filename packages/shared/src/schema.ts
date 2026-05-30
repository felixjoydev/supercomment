import { z } from "zod";

/**
 * SuperComment shared contract.
 *
 * This module is the single source of truth for the annotation / comment shape.
 * The same Zod schemas are reused as:
 *   - the overlay -> RPC payload (`newCommentInputSchema`)
 *   - the security-definer RPC argument shape
 *   - the persisted DB row shape (`commentSchema`)
 *   - the MCP tool input / output schemas
 *
 * Keep this framework-agnostic: no React, DOM, Supabase, or Node imports.
 */

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

// ---------------------------------------------------------------------------
// Captured context (R11 generic + R12 optional React tier)
// ---------------------------------------------------------------------------

/** A bounding box / position in CSS pixels relative to the document. */
export const boundingBoxSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
});
export type BoundingBox = z.infer<typeof boundingBoxSchema>;

/** Viewport dimensions and device pixel ratio at capture time. */
export const viewportSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  devicePixelRatio: z.number().positive().optional(),
});
export type Viewport = z.infer<typeof viewportSchema>;

/**
 * One robust way to re-find the annotated element later. We capture *several*
 * anchors (id, data-testid, role, text, DOM path, etc.) rather than relying on
 * a single brittle CSS selector, so the agent can re-resolve against live DOM.
 */
export const elementAnchorSchema = z.object({
  /** Anchor kind, e.g. "id" | "data-testid" | "role" | "text" | "dom-path". */
  type: z.string().min(1),
  /** The anchor value, e.g. the id, the test id, the quoted text, the path. */
  value: z.string(),
});
export type ElementAnchor = z.infer<typeof elementAnchorSchema>;

/** A single captured console error / warning line. */
export const consoleErrorSchema = z.object({
  level: z.enum(["error", "warn", "log", "info", "debug"]),
  message: z.string(),
  timestamp: z.iso.datetime().optional(),
});
export type ConsoleError = z.infer<typeof consoleErrorSchema>;

/**
 * Optional React-specific context. Present only when the annotated element is
 * backed by a React fiber. `componentPath` (display-name chain) is best-effort
 * via fiber walk (React 18/19); `sourceFile`/`sourceLine` come from
 * `_debugSource` and are only available on React-18/Babel dev builds (R12).
 */
export const reactContextSchema = z.object({
  /** Component display-name chain from the element up the tree. */
  componentPath: z.array(z.string()).min(1),
  /** Best-effort source file path (Tier 2; React-18/Babel only). */
  sourceFile: z.string().optional(),
  /** Best-effort source line number (Tier 2; React-18/Babel only). */
  sourceLine: z.number().int().positive().optional(),
});
export type ReactContext = z.infer<typeof reactContextSchema>;

/**
 * The model-ready context captured for a comment. Generic fields work on any
 * framework (R11); `react` is attached only when applicable (R12).
 */
export const capturedContextSchema = z.object({
  // --- Generic (any framework) ---
  /** Primary (possibly brittle) CSS selector for the target element. */
  selector: z.string().min(1),
  /** Robust multi-anchor set for re-resolving the element. */
  anchors: z.array(elementAnchorSchema),
  /** Relevant computed styles as a flat key/value map. */
  computedStyles: z.record(z.string(), z.string()).optional(),
  /** Outer/surrounding HTML around the target (for agent context). */
  surroundingHtml: z.string().optional(),
  /** Bounding box / position of the target element. */
  boundingBox: boundingBoxSchema.optional(),
  /** The page URL the comment was made on. */
  url: z.url(),
  /** Viewport size + DPR at capture time. */
  viewport: viewportSchema.optional(),
  /** Console errors/warnings captured around the time of the comment. */
  consoleErrors: z.array(consoleErrorSchema).default([]),
  /**
   * Screenshot of the target/region, as a data URL (e.g. "data:image/png;...")
   * or a storage reference resolved by the backend.
   */
  screenshot: z.string().optional(),

  // --- React (optional) ---
  react: reactContextSchema.optional(),
});
export type CapturedContext = z.infer<typeof capturedContextSchema>;

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
});
export type NewCommentInput = z.infer<typeof newCommentInputSchema>;

// ---------------------------------------------------------------------------
// MCP tool I/O shapes
// ---------------------------------------------------------------------------

/**
 * A comment as exposed to the coding agent over MCP. Same data as `Comment`
 * but trust level is surfaced top-level so the agent/dev can apply the
 * guest-exclusion guard (R23).
 */
export const mcpCommentSchema = commentSchema.extend({
  trustLevel: trustLevelSchema,
});
export type McpComment = z.infer<typeof mcpCommentSchema>;

/** Input for `list_open_comments` / `get_all_open`. */
export const listOpenCommentsInputSchema = z.object({
  previewId: z.uuid().optional(),
  /** When false (default), guest-authored comments are excluded (R23). */
  includeGuests: z.boolean().default(false),
});
export type ListOpenCommentsInput = z.infer<typeof listOpenCommentsInputSchema>;

/** Output for `list_open_comments`. */
export const listOpenCommentsOutputSchema = z.object({
  comments: z.array(mcpCommentSchema),
  /** Count of guest comments withheld from this result (R23 transparency). */
  excludedGuestCount: z.number().int().nonnegative().default(0),
});
export type ListOpenCommentsOutput = z.infer<
  typeof listOpenCommentsOutputSchema
>;

/** Input for `get_comment`. */
export const getCommentInputSchema = z.object({
  number: z.number().int().positive(),
  previewId: z.uuid().optional(),
});
export type GetCommentInput = z.infer<typeof getCommentInputSchema>;

/** Output for `get_comment`. */
export const getCommentOutputSchema = z.object({
  comment: mcpCommentSchema.nullable(),
  /** Set when the comment is missing or not actionable (resolved/dismissed). */
  notActionableReason: z.string().optional(),
});
export type GetCommentOutput = z.infer<typeof getCommentOutputSchema>;

/** Input for `resolve_comment`. */
export const resolveCommentInputSchema = z.object({
  number: z.number().int().positive(),
  previewId: z.uuid().optional(),
  summary: z.string().optional(),
});
export type ResolveCommentInput = z.infer<typeof resolveCommentInputSchema>;

/** Input for `dismiss_comment`. */
export const dismissCommentInputSchema = z.object({
  number: z.number().int().positive(),
  previewId: z.uuid().optional(),
  reason: z.string().min(1),
});
export type DismissCommentInput = z.infer<typeof dismissCommentInputSchema>;

/** Output shared by `resolve_comment` / `dismiss_comment`. */
export const mutateCommentOutputSchema = z.object({
  ok: z.boolean(),
  comment: mcpCommentSchema.nullable(),
  message: z.string().optional(),
});
export type MutateCommentOutput = z.infer<typeof mutateCommentOutputSchema>;
