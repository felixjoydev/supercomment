import type { ReactContext } from "@supercomment/shared";

/**
 * Build-time `data-sc-source` stamp reader (U5).
 *
 * React 19.2 / Next 16.2 removed the runtime `_debugSource` / `jsxDEV` source
 * args, so exact `file:line` can no longer be recovered from the fiber. Instead
 * the **preview build** runs `@supercomment/source-stamp` (a Babel plugin) which
 * stamps each JSX element with:
 *
 *     data-sc-source="<relativePath>:<line>:<col>"
 *
 * At capture time we read the NEAREST such attribute via `el.closest()` and fold
 * it into the React context's `sourceFile` / `sourceLine`.
 *
 * This is progressive enhancement: when the attribute is absent (production
 * build, plugin not installed, or a non-React app) callers keep the fiber
 * component-path capture (see react.ts) — no error, just less precision.
 */

/** The attribute the build-time plugin stamps (must match @supercomment/source-stamp). */
export const SOURCE_STAMP_ATTR = "data-sc-source";

/** Parsed pieces of a `data-sc-source` value. */
export interface SourceStamp {
  /** Project-root-relative source file path, e.g. "src/components/Card.tsx". */
  file: string;
  /** 1-based line number, when present and numeric. */
  line?: number;
  /**
   * 0-based column number, when present. Parsed for completeness but NOT
   * currently persisted (the shared schema carries file + line only).
   */
  column?: number;
}

function toInt(value: string | undefined): number | null {
  if (value === undefined || !/^\d+$/.test(value)) {
    return null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse a `data-sc-source` value into its parts. The format is
 * `"<file>:<line>:<col>"`, but a file path may itself contain `:` (rare), so we
 * peel the numeric `line`/`col` off the RIGHT and treat everything before them
 * as the file. Degrades gracefully: a value with no numeric tail is returned as
 * a file-only stamp.
 */
export function parseSourceStamp(value: string): SourceStamp | null {
  const raw = value.trim();
  if (!raw) {
    return null;
  }
  const parts = raw.split(":");

  if (parts.length >= 3) {
    const col = toInt(parts[parts.length - 1]);
    const line = toInt(parts[parts.length - 2]);
    if (line !== null && col !== null) {
      return { file: parts.slice(0, -2).join(":"), line, column: col };
    }
  }
  if (parts.length >= 2) {
    const line = toInt(parts[parts.length - 1]);
    if (line !== null) {
      return { file: parts.slice(0, -1).join(":"), line };
    }
  }
  return { file: raw };
}

/**
 * Read the nearest build-time source stamp for an element via
 * `el.closest('[data-sc-source]')`. Returns `null` when no ancestor carries the
 * attribute (the common production / no-plugin case). Never throws.
 */
export function captureSourceStamp(el: Element): SourceStamp | null {
  let stamped: Element | null = null;
  try {
    stamped = el.closest(`[${SOURCE_STAMP_ATTR}]`);
  } catch {
    return null;
  }
  if (!stamped) {
    return null;
  }
  const value = stamped.getAttribute(SOURCE_STAMP_ATTR);
  if (!value) {
    return null;
  }
  return parseSourceStamp(value);
}

/**
 * Fold a build-time stamp into a React context. The stamp is authoritative for
 * `file:line` on React 19 (where the fiber has no source), so it overrides any
 * value the fiber walk produced.
 *
 *  - No React context (no fiber / no component name) -> returns it unchanged
 *    (the shared schema requires a non-empty `componentPath`, so there is
 *    nothing to attach the source to; the caller stays generic-only).
 *  - No stamp -> returns the React context unchanged (component-path fallback).
 *  - Both present -> sets `sourceFile` (+ `sourceLine` when the stamp has a
 *    positive line; otherwise clears the line to keep file/line consistent).
 */
export function mergeSourceStamp(
  react: ReactContext | null,
  stamp: SourceStamp | null,
): ReactContext | null {
  if (!react || !stamp) {
    return react;
  }
  react.sourceFile = stamp.file;
  if (typeof stamp.line === "number" && stamp.line > 0) {
    react.sourceLine = stamp.line;
  } else {
    delete react.sourceLine;
  }
  return react;
}
