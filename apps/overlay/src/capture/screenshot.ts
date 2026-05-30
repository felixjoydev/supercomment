/**
 * Best-effort element screenshot (U7).
 *
 * The intended production approach is in-page DOM rasterization (html2canvas /
 * snapdom style): serialize the element's subtree into an SVG `<foreignObject>`,
 * draw it to a `<canvas>`, and read back a data URL. This is inherently
 * best-effort and has well-known gaps:
 *
 *   - Cross-origin images / iframes cannot be read back (canvas tainting →
 *     SecurityError); they render blank or throw.
 *   - WebGL / `<canvas>` content is frequently not captured.
 *   - Some modern CSS (certain filters, color spaces, backdrop effects,
 *     `mix-blend-mode`) is unsupported or approximated.
 *   - Web fonts may not be embedded, changing text rendering.
 *
 * Capture must NEVER block comment submission: every path returns `null` on
 * failure rather than throwing. The result, when present, is a string suitable
 * for the shared `screenshot` field (a `data:image/...` URL or a backend
 * storage reference).
 *
 * VERIFY IN REAL ENV: A real rasterizer (html2canvas or snapdom) is not bundled
 * into the injected IIFE in this unit — it adds significant weight and cannot be
 * exercised in jsdom (no real layout, no canvas raster). This module therefore
 * returns `null` today unless a `rasterize` function is injected. To finish in a
 * real browser:
 *   1. Bundle html2canvas (or snapdom) or implement the foreignObject→canvas
 *      path and pass it as `options.rasterize`.
 *   2. Confirm behavior on: cross-origin images (expect blank), a WebGL canvas
 *      (expect missing), web-font text (expect possible substitution), and a
 *      large off-screen element (expect clipping to viewport).
 *   3. Upload the resulting blob and store its ref, or inline the data URL.
 * Until then, `screenshot` stays undefined/null and the rest of capture is
 * unaffected.
 */

/** Options for {@link captureScreenshot}. */
export interface ScreenshotOptions {
  /** Optional injected rasterizer for real-env wiring / testing. */
  rasterize?: (target: Element) => Promise<string | null>;
}

/**
 * Attempt to capture a screenshot reference for {@link target}.
 *
 * Returns a data URL / storage reference string on success, or `null` on any
 * failure (including when no rasterizer is available, the current state).
 */
export async function captureScreenshot(
  target: Element,
  options: ScreenshotOptions = {},
): Promise<string | null> {
  if (!options.rasterize) {
    // VERIFY IN REAL ENV: no rasterizer bundled yet — see file header.
    return null;
  }
  try {
    return await options.rasterize(target);
  } catch {
    // Best-effort: never block on screenshot failure.
    return null;
  }
}
