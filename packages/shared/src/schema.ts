import { z } from "zod";
import { isInsertableTag, isSafeAttr } from "./dom-safety.js";

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
 * One node of the accessibility/ancestor chain around the annotated element
 * (target first, then ancestors). Gives an agent structural + a11y context for
 * locating the right component and catching accessibility issues. All fields are
 * best-effort; `name` is the accessible name (redacted).
 */
export const a11yNodeSchema = z.object({
  tagName: z.string(),
  role: z.string().optional(),
  name: z.string().optional(),
  id: z.string().optional(),
  className: z.string().optional(),
});
export type A11yNode = z.infer<typeof a11yNodeSchema>;

/** Browser/runtime environment at capture time (non-sensitive). */
export const environmentSchema = z.object({
  userAgent: z.string(),
  language: z.string().optional(),
  platform: z.string().optional(),
});
export type Environment = z.infer<typeof environmentSchema>;

/**
 * Client-side storage **keys only** (never values, never cookies). Storage keys
 * hint at app/feature/auth state without exfiltrating tokens or PII; keys are
 * still run through redaction defensively in case a key embeds a secret.
 */
export const appStateSchema = z.object({
  localStorageKeys: z.array(z.string()),
  sessionStorageKeys: z.array(z.string()),
});
export type AppState = z.infer<typeof appStateSchema>;

/** A single recent user action leading up to the comment (repro breadcrumb). */
export const interactionEventSchema = z.object({
  type: z.enum(["click", "input", "change", "submit", "navigation"]),
  /** Compact selector for the action target, when applicable. */
  target: z.string().optional(),
  /**
   * Reserved. Raw input values are intentionally NOT captured (the canonical
   * redactor is best-effort for token shapes and does not cover free-text PII),
   * so this stays optional/empty unless an explicit, future opt-in populates it.
   */
  value: z.string().optional(),
  timestamp: z.iso.datetime(),
});
export type InteractionEvent = z.infer<typeof interactionEventSchema>;

/**
 * A network request observed via the read-only Resource Timing API. Note this
 * deliberately does NOT instrument `fetch`/XHR (no monkeypatch), so HTTP method
 * and status code are unavailable — this keeps capture fully passive and unable
 * to affect the host app. URLs are redacted.
 */
export const networkRequestSchema = z.object({
  url: z.string(),
  initiatorType: z.string().optional(),
  duration: z.number().optional(),
  transferSize: z.number().optional(),
  startTime: z.number().optional(),
});
export type NetworkRequest = z.infer<typeof networkRequestSchema>;

/**
 * Optional React-specific context. Present only when the annotated element is
 * backed by a React fiber. `componentPath` (display-name chain) is best-effort
 * via fiber walk (React 18/19).
 *
 * `sourceFile`/`sourceLine` carry the exact JSX `file:line`. React 19 / Next
 * removed the runtime `_debugSource`/`jsxDEV` source args, so these now come
 * from a **build-time `data-sc-source` stamp** (the `@supercomment/source-stamp`
 * Babel plugin, preview builds only) read at runtime via
 * `el.closest('[data-sc-source]')` — not from the fiber. Both stay optional:
 * absent the plugin (production, no stamp, or a non-React app) only
 * `componentPath` is populated and the fields are omitted (R9/R12).
 */
export const reactContextSchema = z.object({
  /** Component display-name chain from the element up the tree. */
  componentPath: z.array(z.string()).min(1),
  /** Exact source file path from the build-time `data-sc-source` stamp. */
  sourceFile: z.string().optional(),
  /** Exact 1-based source line from the build-time `data-sc-source` stamp. */
  sourceLine: z.number().int().positive().optional(),
  /**
   * Exact 0-based source column from the build-time `data-sc-source` stamp.
   * Lets an edit point at the attribute, not just the JSX tag (R13). Only set
   * when `sourceLine` is present.
   */
  sourceColumn: z.number().int().nonnegative().optional(),
});
export type ReactContext = z.infer<typeof reactContextSchema>;

// ---------------------------------------------------------------------------
// Visual change-set (R12–R14) — the structured intent of a direct-manipulation
// edit. Rides in `context.changeSet`. Each op carries before→after so the agent
// can verify the target and modify the existing declaration, plus anchors + an
// optional source location so it can translate the intent into the repo's own
// styling idiom rather than replaying a raw inline style.
// ---------------------------------------------------------------------------

/** The kind of direct-manipulation edit an op expresses. */
export const changeOpTypeSchema = z.enum([
  "setStyle",
  "setText",
  "setAttr",
  "moveNode",
  "insertNode",
  "removeNode",
  "setVisibility",
]);
export type ChangeOpType = z.infer<typeof changeOpTypeSchema>;

/**
 * The element an op targets. Reuses the multi-anchor set for re-resolution and
 * carries the build-time source location when the host is source-stamped.
 * `sourceUnknown` (non-React / unstamped host) tells the agent to rely on the
 * anchors + screenshot and never fabricate a file path; `anchorUnresolved` marks
 * a target that no longer resolves on the current build (drift).
 */
export const editTargetSchema = z.object({
  selector: z.string().min(1),
  anchors: z.array(elementAnchorSchema),
  source: z
    .object({
      file: z.string(),
      line: z.number().int().positive(),
      column: z.number().int().nonnegative(),
    })
    .optional(),
  sourceUnknown: z.boolean().optional(),
  anchorUnresolved: z.boolean().optional(),
});
export type EditTarget = z.infer<typeof editTargetSchema>;

/** Where a structural op inserts/moves a node, anchored to a real neighbour. */
export const insertionPointSchema = z.object({
  /** The container the node belongs in. */
  parent: editTargetSchema.optional(),
  /** The sibling the position is relative to (for before/after). */
  reference: editTargetSchema.optional(),
  position: z.enum(["before", "after", "append", "prepend"]),
});
export type InsertionPoint = z.infer<typeof insertionPointSchema>;

/**
 * A semantic description of a newly-inserted node (never raw innerHTML).
 *
 * Refined so a stored change-set can never carry a stored-DOM-XSS payload into a
 * viewer's page (M1): the tag must be an insertable presentational element (no
 * `script`/`iframe`/…) and every attribute must pass `isSafeAttr` (no `on*`
 * handlers, no `javascript:`/hostile-`data:` URL values). Enforced again in the
 * overlay apply layer — this is the first, schema-level gate.
 */
export const newNodeSchema = z
  .object({
    tag: z.string().min(1),
    text: z.string().optional(),
    attrs: z.record(z.string(), z.string()).optional(),
  })
  .superRefine((node, ctx) => {
    if (!isInsertableTag(node.tag)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tag"],
        message: `unsafe insert tag: ${node.tag}`,
      });
    }
    for (const [name, value] of Object.entries(node.attrs ?? {})) {
      if (!isSafeAttr(name, value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["attrs", name],
          message: `unsafe attribute: ${name}`,
        });
      }
    }
  });
export type NewNode = z.infer<typeof newNodeSchema>;

/** One direct-manipulation edit, expressed as intent (not a DOM mutation). */
export const changeOpSchema = z.object({
  /** Stable id for this op within the change-set. */
  opId: z.string().min(1),
  type: changeOpTypeSchema,
  target: editTargetSchema,
  /** CSS property (setStyle) or attribute name (setAttr). */
  property: z.string().optional(),
  /** Prior value — always captured when known so the agent can verify + modify. */
  before: z.string().nullable().optional(),
  /** Desired value. */
  after: z.string().nullable().optional(),
  /** Nearest design token for the `after` value, when detectable (theme-robust). */
  valueToken: z.string().optional(),
  /** Breakpoint this edit applies at (default = base / current viewport). */
  responsive: deviceSurfaceSchema.optional(),
  /** Pseudo-state this edit applies to. */
  state: z.enum(["default", "hover", "focus"]).optional(),
  /** Destination for insertNode / moveNode. */
  insertion: insertionPointSchema.optional(),
  /** Sibling reorder indices for moveNode. */
  order: z
    .object({
      from: z.number().int().nonnegative(),
      to: z.number().int().nonnegative(),
    })
    .optional(),
  /** The node to create, for insertNode. */
  node: newNodeSchema.optional(),
})
  .superRefine((op, ctx) => {
    // A setAttr op writes property=after onto an EXISTING element, so it is a
    // stored-DOM-XSS sink just like an inserted node (M1). Reject `on*` handlers
    // and `javascript:`/hostile-`data:` URL values here too. (insertNode's `node`
    // is already gated by newNodeSchema above.)
    if (op.type === "setAttr" && op.property != null && op.after != null) {
      if (!isSafeAttr(op.property, op.after)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["after"],
          message: `unsafe attribute: ${op.property}`,
        });
      }
    }
  });
export type ChangeOp = z.infer<typeof changeOpSchema>;

/**
 * The full set of edits for a `template` comment. `authoredCommit` records the
 * build the edits were authored against so the viewer/agent can refuse to replay
 * onto a drifted build (the screenshot is the record instead).
 */
export const visualChangeSetSchema = z.object({
  authoredCommit: z.string().optional(),
  ops: z.array(changeOpSchema).min(1),
});
export type VisualChangeSet = z.infer<typeof visualChangeSetSchema>;

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
   * Screenshot of the target/region — for a visual edit, the MODIFIED state.
   * Normally a Storage reference (a path in the captures bucket, resolved to a
   * signed/authenticated URL on read); may be a small inline data URL as a
   * fallback. Real rasters are stored out-of-band, never inlined — an inlined
   * full-page PNG would collide with the guest `context` size cap and bloat
   * every comment/MCP read (R15–R18).
   */
  screenshot: z.string().optional(),

  // --- Additive runtime context (all optional; older comments omit these) ---
  /** Accessibility/ancestor chain around the target (target first). */
  a11yTree: z.array(a11yNodeSchema).optional(),
  /** Browser/runtime environment (user agent, language, platform). */
  environment: environmentSchema.optional(),
  /** Client-side storage keys (no values, no cookies). */
  appState: appStateSchema.optional(),
  /** Recent user actions leading up to the comment (repro breadcrumbs). */
  interactionTrail: z.array(interactionEventSchema).optional(),
  /** Recent network requests via read-only Resource Timing (no method/status). */
  networkRequests: z.array(networkRequestSchema).optional(),
  /** Device surface the comment was made on (auto from viewport, or device-mode). */
  surface: deviceSurfaceSchema.optional(),

  // --- Provenance (R14) — which deploy/commit the comment was captured against ---
  /** Deploy origin the comment was made against (the customer's preview URL). */
  deployUrl: z.url().optional(),
  /** Commit SHA the deploy was built from, when the build injects it. */
  commit: z.string().optional(),

  // --- Visual edit (R12–R14, R19) ---
  /** Structured change-set for a `template` (visual-edit) comment. */
  changeSet: visualChangeSetSchema.optional(),
  /** Storage refs for reviewer-uploaded reference images ("what I want"), R19. */
  referenceImages: z.array(z.string()).optional(),

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
  /** `comment` (ordinary) or `template` (carries a visual change-set), R11. */
  kind: commentKindSchema.default("comment"),
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

/** Input for `list_open_comments` / `get_all_open`. */
export const listOpenCommentsInputSchema = z.object({
  previewId: z.uuid().optional(),
  /**
   * When true (default), guest-authored comments are included (they're labeled
   * with trust_level and the result is marked untrusted). Set false to exclude
   * guests; `excludedGuestCount` then reports how many were withheld (R23).
   */
  includeGuests: z.boolean().default(true),
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
