/**
 * Per-comment, element-scoped "before" artifact capture (U9, R15).
 *
 * The "before" artifact is the capture-time record of the ANNOTATED ELEMENT — the
 * "before" half of the before/after comparison across redeploys. It is captured
 * PER COMMENT, scoped to the targeted element, AT SUBMIT — never a deferred
 * whole-page rasterizer (a whole-document snapshot is not an element before/after,
 * which is exactly the F7 gap this unit closes).
 *
 * Two-step, element-scoped fallback chain (best-effort throughout):
 *
 *   1. RASTER (preferred): when an injected `rasterize` function is present, draw
 *      JUST the target element's box to an image and return a data URL. The
 *      intended production approach is in-page DOM rasterization (html2canvas /
 *      snapdom style: serialize the element subtree into an SVG `<foreignObject>`,
 *      draw it to a `<canvas>`, read back a data URL). It is deliberately NOT
 *      bundled here (it adds significant weight and pulls no place in the
 *      supabase-js-free IIFE) and cannot run under jsdom (no real layout, no
 *      canvas raster), so it stays injectable/optional.
 *
 *   2. SNAPSHOT FALLBACK (always available): when no rasterizer is wired, or it
 *      returns `null` / throws, fall back to an ELEMENT-SUBTREE DOM snapshot —
 *      reusing the snapshot serializer on the ELEMENT (not the whole document, so
 *      no document-wide stylesheets) — encoded as a non-image
 *      `data:application/json,...` URL. This works in any DOM and yields a real,
 *      structural "before".
 *
 * Returns `null` ONLY when BOTH steps fail. NEVER throws and NEVER blocks comment
 * submission: every failure path returns `null`. The result, when present, is a
 * string for the shared `context.screenshot` field — an image data URL / storage
 * ref from raster, or the JSON snapshot data URL from the fallback. The dashboard
 * distinguishes the two by data-URL MIME (image → `<img>`; otherwise a "snapshot
 * captured" indicator).
 *
 * VERIFY IN REAL ENV: real rasterization needs a real browser.
 *   1. Bundle/inject html2canvas or snapdom (or implement the foreignObject→canvas
 *      path) and pass it as `options.rasterize`.
 *   2. Confirm behavior on cross-origin images (canvas taint → SecurityError,
 *      caught here → snapshot fallback), a WebGL/`<canvas>` element (content
 *      missing), web-font text (possible substitution), and a large off-screen
 *      element (clipping to viewport).
 *   3. Upload the resulting blob + store its ref, or inline the data URL.
 * Until a rasterizer is wired, every "before" is the element-subtree snapshot
 * fallback (which IS exercised and unit-tested).
 */
import type { SnapshotPayload } from "@supercomment/shared";

import { captureSnapshot } from "../snapshot/capture.js";

/**
 * Data-URL prefix marking the element-subtree DOM snapshot fallback artifact.
 * The dashboard keys off this (a non-image `data:` URL) to render a "snapshot
 * captured" indicator instead of a broken `<img>`.
 */
export const BEFORE_ARTIFACT_SNAPSHOT_PREFIX = "data:application/json,";

/**
 * Byte cap for the fallback element-subtree snapshot payload (pre-encoding), so a
 * large subtree can't bloat the stored comment context. The serializer truncates
 * the node tree past this and flags it `truncated`.
 */
export const BEFORE_ARTIFACT_MAX_BYTES = 256_000;

/** Options for {@link captureScreenshot} / {@link attachBeforeArtifact}. */
export interface ScreenshotOptions {
  /**
   * Optional injected element rasterizer (real-env wiring / tests). Receives the
   * target element and resolves to an image data URL / storage ref, or `null`.
   */
  rasterize?: (target: Element) => Promise<string | null>;
  /**
   * Injectable element-subtree snapshot fn (tests / alternate serializers).
   * Defaults to the snapshot-serializer-backed element capture. Returns a string
   * artifact (a data URL) or `null`.
   */
  snapshot?: (target: Element) => string | null;
  /** Byte cap for the default snapshot fallback; see {@link BEFORE_ARTIFACT_MAX_BYTES}. */
  maxSnapshotBytes?: number;
}

/**
 * Capture a best-effort, element-scoped "before" artifact for {@link target}.
 *
 * Raster first (when wired); on absence/failure an element-subtree DOM snapshot.
 * Returns the artifact string, or `null` only when BOTH fail. Never throws.
 */
export async function captureScreenshot(
  target: Element,
  options: ScreenshotOptions = {},
): Promise<string | null> {
  // 1) Best-effort element raster (preferred when a rasterizer is wired).
  if (options.rasterize) {
    try {
      const raster = await options.rasterize(target);
      if (raster) return raster;
    } catch {
      // Raster failed (e.g. canvas taint on cross-origin content) — fall back.
    }
  }

  // 2) Element-subtree DOM snapshot fallback — always attempted.
  const snapshot =
    options.snapshot ??
    ((el: Element) => defaultElementSnapshot(el, options.maxSnapshotBytes));
  try {
    const artifact = snapshot(target);
    if (artifact) return artifact;
  } catch {
    // Both raster and snapshot failed.
  }

  return null;
}

/**
 * Attach a best-effort "before" artifact onto a captured context at submit time
 * (R15), returning the (possibly augmented) context.
 *
 * Pure + NEVER throws, so the submit path can call it without a guard and a
 * capture failure can NEVER block submission. An already-present
 * `context.screenshot` (e.g. the capturer already rastered) is kept untouched; a
 * `null` element (area / text selections with no element) is a no-op.
 */
export async function attachBeforeArtifact<T extends { screenshot?: string }>(
  context: T,
  element: Element | null,
  options: ScreenshotOptions = {},
): Promise<T> {
  if (context.screenshot || !element) {
    return context;
  }
  try {
    const before = await captureScreenshot(element, options);
    if (before) context.screenshot = before;
  } catch {
    // Best-effort: a before-artifact failure must never block submit.
  }
  return context;
}

/**
 * Default element-subtree snapshot: serialize JUST the element's subtree (not the
 * whole document — `documentElement` is the element and no `styleSheets` are
 * supplied, so document-wide CSS is excluded), bounded by a byte cap, and encode
 * it as a non-image `data:application/json,...` URL. Returns `null` on failure.
 */
function defaultElementSnapshot(
  target: Element,
  maxBytes?: number,
): string | null {
  try {
    const view = target.ownerDocument?.defaultView ?? undefined;
    const href = safeHref(view);
    const origin = safeOrigin(view) ?? href;
    const payload = captureSnapshot(
      // Element-as-root: serializeDocument uses `documentElement` as the root and
      // reads `styleSheets` (absent here → none), so this is element-scoped.
      { documentElement: target } as unknown as Parameters<
        typeof captureSnapshot
      >[0],
      {
        url: href,
        baseUrl: href,
        origin,
        maxBytes: maxBytes ?? BEFORE_ARTIFACT_MAX_BYTES,
        reactContext: null,
      },
    );
    return encodeSnapshotArtifact(payload);
  } catch {
    return null;
  }
}

/** Encode a snapshot payload as the before-artifact data URL (UTF-8 safe). */
export function encodeSnapshotArtifact(payload: SnapshotPayload): string {
  return (
    BEFORE_ARTIFACT_SNAPSHOT_PREFIX + encodeURIComponent(JSON.stringify(payload))
  );
}

function safeHref(view: { location?: { href?: string } } | undefined): string {
  try {
    return view?.location?.href ?? "about:blank";
  } catch {
    return "about:blank";
  }
}

function safeOrigin(
  view: { location?: { origin?: string } } | undefined,
): string | undefined {
  try {
    return view?.location?.origin ?? undefined;
  } catch {
    return undefined;
  }
}
