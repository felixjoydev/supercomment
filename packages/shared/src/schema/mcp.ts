import { z } from "zod";
import { trustLevelSchema } from "./enums.js";
import { commentSchema } from "./comment.js";

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
  /**
   * One-line inventory of all captured signals (relevance layer). Always
   * present on agent-facing comments so the agent knows what exists even when a
   * triage view curates the bulky fields out — it can pull the rest with
   * `get_comment`.
   */
  contextSignals: z.string().optional(),
  /**
   * Deterministic plain-language rendering of a `template` comment's visual
   * change-set (U16), delivered ALONGSIDE the structured `context.changeSet` so
   * the agent reads the intent both ways. Proposed intent — requiring source /
   * human verification — never an instruction to apply verbatim.
   */
  changeSetSummary: z.string().optional(),
});
export type McpComment = z.infer<typeof mcpCommentSchema>;

/** Output for `list_open_comments`. */
export const listOpenCommentsOutputSchema = z.object({
  comments: z.array(mcpCommentSchema),
  /** Count of guest comments withheld from this result (R23 transparency). */
  excludedGuestCount: z.number().int().nonnegative().default(0),
});
export type ListOpenCommentsOutput = z.infer<
  typeof listOpenCommentsOutputSchema
>;

/** Output for `get_comment`. */
export const getCommentOutputSchema = z.object({
  comment: mcpCommentSchema.nullable(),
  /** Set when the comment is missing or not actionable (resolved/dismissed). */
  notActionableReason: z.string().optional(),
});
export type GetCommentOutput = z.infer<typeof getCommentOutputSchema>;

/**
 * Input for `resolve_comment`. NOTE: the MCP server (apps/cli/src/mcp/tools.ts)
 * currently declares each tool's inputSchema inline as a ZodRawShape, so these
 * *InputSchema objects are not yet the wired source of truth. The sibling
 * list/get/dismiss input schemas were unused and removed; this one is retained
 * because it still has direct test coverage (schema.test.ts).
 */
export const resolveCommentInputSchema = z.object({
  number: z.number().int().positive(),
  previewId: z.uuid().optional(),
  summary: z.string().optional(),
});
export type ResolveCommentInput = z.infer<typeof resolveCommentInputSchema>;

/** Output shared by `resolve_comment` / `dismiss_comment`. */
export const mutateCommentOutputSchema = z.object({
  ok: z.boolean(),
  comment: mcpCommentSchema.nullable(),
  message: z.string().optional(),
});
export type MutateCommentOutput = z.infer<typeof mutateCommentOutputSchema>;
