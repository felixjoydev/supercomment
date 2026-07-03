import { z } from "zod";

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

