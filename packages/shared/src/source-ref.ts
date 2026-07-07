import type { CapturedContext } from "./schema.js";

/**
 * U11 (shared) — format a comment's captured source location as a `file:line`
 * reference. Shared by the web dashboard's "Send to Claude" hand-off and (later)
 * the CLI's hand-off view, so both agree on the exact grounding string pointed
 * at real source (R16).
 *
 * Pure, dependency-free (no React/DOM), so it is usable from any runtime.
 */

/**
 * Format a comment's captured source location as a `file:line` reference (or
 * `file` alone when only the file is known). Returns null when the comment has
 * no build-time source stamp (no plugin / production / non-React app).
 */
export function sourceRefFromContext(
  context: CapturedContext | null | undefined,
): string | null {
  const react = context?.react;
  const file = react?.sourceFile;
  if (!file) return null;
  return react?.sourceLine ? `${file}:${react.sourceLine}` : file;
}
