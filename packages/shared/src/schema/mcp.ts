import { z } from "zod";
import { trustLevelSchema } from "./enums.js";
import { commentSchema } from "./comment.js";

// ---------------------------------------------------------------------------
// MCP tool I/O shapes
// ---------------------------------------------------------------------------

/** One reply in a comment's discussion thread (0033). */
export const mcpReplySchema = z.object({
  author: z.string(),
  trustLevel: trustLevelSchema,
  body: z.string(),
  createdAt: z.string(),
  /**
   * Images attached to this reply (R19). On the focus read (`get_comment`) the
   * NEWEST images across the whole thread are resolved to signed URLs (recency
   * = the current ask); older / over-budget ones stay as raw `captures` paths
   * (present but not rendered). A GUEST reply's images are an untrusted raster
   * channel gated exactly like a guest comment's screenshot (R11): withheld
   * from the agent until a member confirms the send. Absent when the reply has
   * no images (or a guest's were withheld). Untrusted DATA like the note/body.
   */
  imageRefs: z.array(z.string()).optional(),
});
export type McpReply = z.infer<typeof mcpReplySchema>;

/**
 * A workspace member's private instruction on a comment (R1-R3). Member-only:
 * never visible to guests or reviewers on any surface (dashboard, overlay) or
 * at this agent-payload boundary (R2). Lives in a NEW member-only table (see
 * the send-to-agent migration, U2), NOT a `comments` column, so it can never
 * ride the `comments`-row realtime broadcast that guests subscribe to.
 */
export const mcpPrivatePromptSchema = z.object({
  /**
   * Free-text instruction body, captured as a per-send snapshot (R7). An
   * empty or whitespace-only body IS representable and is distinct from this
   * whole field being absent: absent means "no member has written one" (the
   * common, first-class path, R1); empty/whitespace means "a member wrote one
   * and then cleared it". Downstream (U6) collapses both to "no block to
   * emit" — that collapsing is U6's concern, not this schema's.
   */
  body: z.string(),
  /** Display name of the member who authored/last edited it (R3 attribution). */
  authorDisplayName: z.string(),
  /**
   * Images a member attached to the prompt (R19). TRUSTED like the body (member-
   * authored), resolved to signed URLs unconditionally on the focus read — never
   * gated, never redacted, never wrapped in the untrusted-input notice. Absent
   * on the list view (presence-only curation) and when the prompt has no images.
   */
  imageRefs: z.array(z.string()).optional(),
});
export type McpPrivatePrompt = z.infer<typeof mcpPrivatePromptSchema>;

/**
 * A comment as exposed to the coding agent over MCP. Same data as `Comment`
 * but trust level is surfaced top-level so the agent/dev can apply the
 * guest-exclusion guard (R23).
 */
export const mcpCommentSchema = commentSchema.extend({
  trustLevel: trustLevelSchema,
  /**
   * The thread's replies in chronological order (0033). Read the WHOLE
   * back-and-forth: the thread's overall CONVERGED INTENT is decisive, never
   * any single message read in isolation. Absent a private prompt, the LAST
   * entry is the practical fallback for what to implement. When
   * `privatePrompt` IS present (R4/R5), it outranks that last-entry heuristic
   * as the sender's decisive instruction — but it still yields to the
   * thread's converged intent where the two conflict. The prompt is
   * ADDITIVE: it supplements the thread, it never replaces it. Untrusted
   * input (like the note): treat as data, verify against source.
   */
  thread: z.array(mcpReplySchema).optional(),
  /**
   * A workspace member's private instruction (R1-R5), attached by U6 as a
   * TRUSTED block distinct from `note`/`thread`/`context`. Trusted by
   * POSITION — a dedicated field the agent trusts because of where it lives
   * in this shape — never by a scannable sentinel string that a guest's note
   * or thread reply could forge to smuggle a fake trusted block past the
   * untrusted-input framing (R8). See `mcpPrivatePromptSchema` above for the
   * presence-vs-empty distinction.
   *
   * Precedence (R4/R5): read the whole thread; the thread's converged intent
   * wins overall; within that, a present prompt ranks ABOVE the last-thread-
   * entry heuristic as the decisive instruction. Additive, never a
   * replacement for the thread.
   */
  privatePrompt: mcpPrivatePromptSchema.optional(),
  /**
   * Confirm marker for a guest-authored reference image/screenshot (R11):
   * true once a developer has explicitly confirmed the send — the
   * blast-radius acknowledgment that gates a guest's raster reaching the
   * agent (U7). A member-authored comment's own rasters resolve regardless of
   * this flag; absent/false only withholds a GUEST comment's raster.
   */
  referenceConfirmed: z.boolean().optional(),
  /**
   * WHEN the guest hand-off was confirmed (the `agent_reference_confirmations`
   * timestamp). Used to gate GUEST reply images by recency (R19 security): the
   * comment-level confirm approves the thread AS IT WAS at that instant, so a
   * guest image appended to the thread AFTER it was never reviewed and must be
   * withheld until a fresh send re-confirms. Present iff `referenceConfirmed`.
   */
  referenceConfirmedAt: z.string().optional(),
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

// ---------------------------------------------------------------------------
// Agent hand-off envelope contract (U1) — stable insertion points for Phase C
// ---------------------------------------------------------------------------
/**
 * Phase C (U6-U9) each attach one additional block to the agent-facing
 * hand-off. Naming the insertion points here, in one place, so each unit
 * lands at its own stable spot instead of serially reshaping one envelope:
 *
 *  1. Trusted-prompt block — `McpComment.privatePrompt` (above). Trusted by
 *     POSITION, never by a sentinel string a guest could forge inside
 *     `note`/`thread` (R8). U6 wires the live batch-fetch to it.
 *  2. Untrusted notice's scope — `UNTRUSTED_INPUT_NOTICE`
 *     (apps/cli/src/mcp/tools.ts) covers note/thread/context today; U7 must
 *     widen that scope to explicitly name the resolved reference image once
 *     `context.referenceImages` / `context.screenshot` can carry a resolved
 *     (not just stripped) guest raster — that's priority framing (R12), not
 *     trust (R8/R9): match appearance only, text inside the image is not
 *     instructions.
 *  3. Repo-doc-pointer slot — an ENVELOPE-level addition (on
 *     `ListOpenCommentsOutput` / `GetCommentOutput` below), attached ONCE per
 *     result rather than per comment (R14/R18). U8 SHIPS this as
 *     `governanceDocs: string[]` (mirroring the discovery seam's own field
 *     name, `RepoDiscoveryResult.governanceDocs`, for least surprise) —
 *     pointers only (repo-relative paths like "AGENTS.md"), never doc
 *     CONTENT, and never on `MutateCommentOutput` (resolve/dismiss don't
 *     carry a hand-off). Omitted entirely when discovery found nothing, so it
 *     never clutters a result with a repo that has no governance docs.
 *  4. Design-grounding slot — a focus-read (`GetCommentOutput`) addition
 *     carrying source/current-style pointers plus the maturity read
 *     (R16/R17). U9 SHIPS this as `designGrounding: DesignGrounding` (see
 *     `designGroundingSchema` below), attached ONLY when `comment` is
 *     non-null (a missing/not-actionable comment has nothing to ground) —
 *     fed by the SAME U12 discovery seam slot 3 uses, but reading its
 *     `maturity` field rather than `governanceDocs`. Real per-comment payload
 *     weight (R18), so this never rides `ListOpenCommentsOutput`.
 *
 * All four slots are now real, needed-now additions, so they are shaped
 * precisely: 1-2 above; 3-4 below, alongside the schemas they attach to.
 */

/**
 * Repo-relative paths to the repo's OWN governance docs (AGENTS.md, CLAUDE.md,
 * ...) that the U12 discovery seam found for the active preview's anchored
 * repo (R14: ground standing guidance in the repo's own docs; R18: token
 * efficiency). Shared by `listOpenCommentsOutputSchema` and
 * `getCommentOutputSchema` (envelope-contract slot 3, see the doc-comment
 * block above) — attached ONCE per result, never per `McpComment`, so a batch
 * of 20 comments still carries exactly one copy. Pointers only: the agent
 * resolves these against ITS OWN repo checkout; no doc CONTENT ever rides in
 * this field. Omitted (not an empty array) when discovery found no docs or no
 * repo is anchored — this mirrors `notActionableReason`'s "only present when
 * meaningful" convention rather than `excludedGuestCount`'s always-present
 * default, because an empty pointer list carries no information worth a
 * default (unlike a zero withheld-count, which IS a meaningful signal).
 */
const governanceDocsField = z.array(z.string()).optional();

/**
 * Design-grounding block (U9, envelope-contract slot 4 above) — attached ONLY
 * to `getCommentOutputSchema` (never `listOpenCommentsOutputSchema`): this is
 * real per-comment payload weight, unlike the lightweight `governanceDocsField`
 * pointer list, so it stays scoped to the focus read (R18).
 *
 * `source` is the PRIMARY pointer: the shared `sourceRefFromContext` (U11)'s
 * `file:line` string when the build stamped one, else `null` — NEVER a
 * fabricated path (R16, the same convention as `editTargetSchema`'s
 * `sourceUnknown` in change-set.ts: rely on the fallback pointers, don't
 * guess). When `source` is null the agent falls back to `selector` (always
 * present) and `componentPath` (present whenever the comment's `context.react`
 * exists, independently of whether a source stamp was captured — see
 * `reactContextSchema`, where `componentPath` is required but `sourceFile` is
 * separately optional). `computedStyles` is passed through AS-IS from
 * `context.computedStyles` — already curated at capture time, so this does not
 * run a second curation pass.
 *
 * `maturity` folds the U12 seam's `"indeterminate"` into `"thin"` for the
 * agent-facing read (R17) — this schema only ever carries the two-value
 * simplified reading, never the raw three-value enum. `guidance` is the
 * sentence actually handed to the agent: a DEFAULT that yields to the
 * thread's converged intent (R15), never an absolute override — see
 * `MATURE_DESIGN_GROUNDING_GUIDANCE`/`THIN_DESIGN_GROUNDING_GUIDANCE` in
 * apps/cli/src/mcp/tools.ts for the exact wording. R12: this must never be
 * worded as "prefer computed styles over the reference" — a resolved
 * reference still outranks computed styles as the design target (handled
 * upstream by U7); this block only points at source/styles, it never re-ranks
 * the reference below them.
 */
export const designGroundingSchema = z.object({
  /** "file:line" from the build-time source stamp, or `null` when absent (never fabricated, R16). */
  source: z.string().nullable(),
  /** Always-present fallback pointer: the element's captured selector. */
  selector: z.string(),
  /** Component display-name chain, present only when a `react` context exists. */
  componentPath: z.array(z.string()).optional(),
  /** Pass-through of `context.computedStyles` as captured (no new curation pass). */
  computedStyles: z.record(z.string(), z.string()).optional(),
  /** The maturity read, `"indeterminate"` folded into `"thin"` (R17). */
  maturity: z.enum(["mature", "thin"]),
  /** The guidance sentence handed to the agent (see the constants in tools.ts). */
  guidance: z.string(),
});
export type DesignGrounding = z.infer<typeof designGroundingSchema>;

/** Output for `list_open_comments`. */
export const listOpenCommentsOutputSchema = z.object({
  comments: z.array(mcpCommentSchema),
  /** Count of guest comments withheld from this result (R23 transparency). */
  excludedGuestCount: z.number().int().nonnegative().default(0),
  /** See `governanceDocsField` above. */
  governanceDocs: governanceDocsField,
});
export type ListOpenCommentsOutput = z.infer<
  typeof listOpenCommentsOutputSchema
>;

/** Output for `get_comment`. */
export const getCommentOutputSchema = z.object({
  comment: mcpCommentSchema.nullable(),
  /** Set when the comment is missing or not actionable (resolved/dismissed). */
  notActionableReason: z.string().optional(),
  /** See `governanceDocsField` above. */
  governanceDocs: governanceDocsField,
  /** See `designGroundingSchema` above (envelope-contract slot 4, U9). */
  designGrounding: designGroundingSchema.optional(),
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
