import { z } from "zod";
import { isInsertableTag, isSafeAttr } from "../dom-safety.js";
import { deviceSurfaceSchema } from "./enums.js";
import {
  boundingBoxSchema,
  viewportSchema,
  elementAnchorSchema,
  consoleErrorSchema,
  a11yNodeSchema,
  environmentSchema,
  appStateSchema,
  interactionEventSchema,
  networkRequestSchema,
  reactContextSchema,
} from "./context.js";

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

/**
 * Font identity for a `font-family` setStyle op (U7). Additive + optional (older
 * comments omit it). The `after` value already carries the CSS stack the agent
 * writes; this describes WHICH font the reviewer chose so the agent installs it
 * the repo's way (add a `next/font` import, an `@font-face`, a Google `<link>`,
 * or wire the uploaded file) rather than guessing from the raw stack.
 *
 * `family` is a human display name — framework-mangled artifacts (`next/font`'s
 * `__Inter_abc123` / `_Fallback` variants) are normalized before they land here.
 * When a name was normalized, `rawStack` preserves the true computed stack so the
 * agent can still map it back to the source, per the U7 "never record a mangled
 * artifact without the raw stack alongside it" rule.
 */
export const fontIdentitySchema = z.object({
  /** Human display family name, e.g. "Inter" (mangled artifacts normalized out). */
  family: z.string().min(1),
  /** Provenance: already rendered on the page, the Google catalog, or an upload. */
  source: z.enum(["page", "google", "upload"]),
  /** Storage ref for an uploaded font file (U9), present only when source=upload. */
  fileRef: z.string().optional(),
  /** Weights the family offers (numeric strings or a variable range like "100 900"). */
  weights: z.array(z.string()).optional(),
  /** The raw computed font-family stack, kept when `family` was normalized. */
  rawStack: z.string().optional(),
});
export type FontIdentity = z.infer<typeof fontIdentitySchema>;

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
  /**
   * Set when the live preview could not be verified on the reviewer's page (site
   * CSS won even after an `!important` escalation, a font never loaded, or a media
   * swap failed to load). The `after` value is still the reviewer's clean intent;
   * this only tells the agent the screenshot may not reflect it, so it should
   * trust the change-set over the raster. Additive + optional (older comments omit
   * it); never affects how the op is applied.
   */
  previewUnavailable: z.boolean().optional(),
  /**
   * Chosen font identity for a `font-family` setStyle op (U7). Additive + optional;
   * describes which font the reviewer picked (family + provenance + weights) so the
   * agent installs it the repo's way. Never changes how the op is applied.
   */
  font: fontIdentitySchema.optional(),
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

