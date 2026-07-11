/**
 * Enhanced-code-context helpers (R10/R11), shared by the dashboard panel, the
 * "Send to Claude" button, and the /api/send-to-claude route. Kept pure and
 * dependency-free (no React/DOM at module scope) so the node test env can
 * exercise the detection + hand-off logic directly.
 *
 * Two concerns:
 *   1. DETECTION — does this preview have exact file:line context? The overlay
 *      stamps `context.react.sourceFile` only when the customer's preview build
 *      runs @supercomment/source-stamp (U5); otherwise only a component path is
 *      captured.
 *   2. HAND-OFF — turn a comment's source location into the `file:line` string
 *      attached to the AI hand-off, gated by the developer's per-preview
 *      "include file:line" preference (default ON).
 *
 * The localStorage accessors are window-guarded so importing this module is safe
 * on the server / in node tests; they only touch storage when called in-browser.
 */

import { sourceRefFromContext, type CapturedContext } from "@supercomment/shared";
import type { CommentView } from "./types";

/** Default for the per-preview "include file:line in AI hand-offs" toggle. */
export const INCLUDE_SOURCE_DEFAULT = true;

/**
 * Format a comment's captured source location as a `file:line` reference (or
 * `file` alone when only the file is known). Returns null when the comment has
 * no build-time source stamp (no plugin / production / non-React app).
 *
 * Moved to `@supercomment/shared` (U11) so `apps/cli` can reuse the exact same
 * formatting; re-exported here so existing web imports keep working unchanged.
 */
export { sourceRefFromContext };

/**
 * The `file:line` to attach to the AI hand-off: present only when the comment
 * actually carries a source stamp AND the developer's toggle is on. Toggle off,
 * or source absent (AE7), yields null so the hand-off omits it.
 */
export function handoffSourceRef(
  context: CapturedContext | null | undefined,
  includeSource: boolean,
): string | null {
  if (!includeSource) return null;
  return sourceRefFromContext(context);
}

/**
 * Auto-detection for the dashboard panel: true when ANY of the preview's
 * comments carries an exact `file:line` stamp — i.e. enhanced code context is
 * active for this preview.
 */
export function hasEnhancedContext(
  comments: Pick<CommentView, "context">[],
): boolean {
  return comments.some((c) => Boolean(c.context?.react?.sourceFile));
}

// --- per-preview client preference (localStorage; window-guarded) -----------

/** localStorage key for a preview's "include file:line" preference. */
export function includeSourceStorageKey(previewId: string): string {
  return `sc:include-source:${previewId}`;
}

/**
 * Read the toggle (default ON). Safe anywhere: returns the default off-browser
 * or when storage is unavailable, so SSR and node tests never throw.
 */
export function readIncludeSourcePref(previewId: string): boolean {
  if (typeof window === "undefined") return INCLUDE_SOURCE_DEFAULT;
  try {
    const raw = window.localStorage.getItem(includeSourceStorageKey(previewId));
    if (raw === null) return INCLUDE_SOURCE_DEFAULT;
    return raw === "1";
  } catch {
    return INCLUDE_SOURCE_DEFAULT;
  }
}

/** Persist the toggle. No-op off-browser / when storage is unavailable. */
export function writeIncludeSourcePref(previewId: string, value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      includeSourceStorageKey(previewId),
      value ? "1" : "0",
    );
  } catch {
    // storage disabled (private mode / quota) — preference just won't persist.
  }
}
