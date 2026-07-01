/**
 * U6 — real screenshot capture: capture sanitizer + injectable rasterizer wrapper.
 *
 * `captureScreenshot` (screenshot.ts) takes an injectable `rasterize` fn; this
 * module provides it. Two concerns live here:
 *
 *  1. SANITIZE (security-critical, sandbox-testable). A raster of the modified
 *     DOM is an un-redactable channel to a third-party LLM (the change-set text
 *     redactor cannot scrub a picture). Before anything is serialized we blank
 *     user-typed content on a DETACHED CLONE — form field values, password
 *     fields, textarea content — so a screenshot can never carry typed
 *     secrets/PII. The live DOM is never touched. See `sanitizeCaptureClone`.
 *
 *  2. RASTERIZE (real-env). `createRasterizer` clones the target (or the whole
 *     document for a full-page shot), sanitizes the clone, then delegates to a
 *     low-level `serialize` fn — the actual DOM→image step. The real serializer
 *     (snapDOM / modern-screenshot / foreignObject→canvas) needs a real browser
 *     (layout + canvas), so it is INJECTED, not bundled into the supabase-js-free
 *     IIFE. The wrapper is what makes scope + sanitize testable with a fake
 *     serializer; the real serializer is wired at boot in a real browser.
 *
 * VERIFY IN REAL ENV: wire snapDOM/modern-screenshot as the `serialize` fn and
 * confirm behavior on cross-origin images (canvas taint → SecurityError → this
 * returns null → screenshot.ts falls back to the DOM snapshot), web-font
 * substitution, blank cross-origin iframes, and off-screen clipping (R15–R17).
 */

/**
 * `<input>` types whose value is user-entered and therefore potentially
 * sensitive. Buttons/checkboxes/radios/hidden carry no free-text and are left so
 * the capture still looks right.
 */
const SENSITIVE_INPUT_TYPES = new Set([
  "text",
  "password",
  "email",
  "tel",
  "number",
  "search",
  "url",
  "date",
  "datetime-local",
  "month",
  "week",
  "time",
]);

/**
 * Blank user-typed content on a DETACHED capture clone so a screenshot cannot
 * carry typed secrets/PII to the agent (G1). Best-effort + NEVER throws; operates
 * only on the passed clone, never the live DOM. Removes the reflected `value` AND
 * the `value` attribute (SVG/HTML serialization reads the attribute), and clears
 * textarea text. A `type`-less input is treated as sensitive (default is text).
 */
export function sanitizeCaptureClone(root: Element): void {
  try {
    const fields = root.querySelectorAll?.("input, textarea") ?? [];
    fields.forEach?.((el: Element) => blankSensitiveField(el));
  } catch {
    /* never throws — a sanitize failure must not block capture/submit */
  }
}

/**
 * Blank one node's user-typed content if it is a sensitive field — a textarea or
 * a text-bearing `<input>` (see {@link SENSITIVE_INPUT_TYPES}). No-ops for any
 * other node. Removes the reflected `value` property AND the `value` attribute
 * (real DOM→image serializers copy the live `.value` into a `value` attribute on
 * their clone, so both must go). Best-effort, never throws.
 *
 * Exported so BOTH the detached-clone path ({@link sanitizeCaptureClone}) and the
 * live-DOM rasterizer's per-cloned-node hook (rasterize-live.ts) scrub fields the
 * SAME way — a single source of truth for the G1 screenshot-PII defense.
 */
export function blankSensitiveField(node: Node): void {
  try {
    const el = node as Element;
    const tag = (el.tagName || "").toUpperCase();
    if (tag === "TEXTAREA") {
      (el as unknown as { textContent: string }).textContent = "";
      el.removeAttribute?.("value");
      return;
    }
    if (tag !== "INPUT") {
      return;
    }
    const type = (el.getAttribute?.("type") || "text").toLowerCase();
    if (!SENSITIVE_INPUT_TYPES.has(type)) {
      return;
    }
    try {
      (el as unknown as { value: string }).value = "";
    } catch {
      /* value may be read-only on the clone in some engines */
    }
    el.removeAttribute?.("value");
  } catch {
    /* per-field best-effort */
  }
}

/** Low-level DOM→image serializer (real-env: snapDOM / foreignObject→canvas). */
export type SerializeToImage = (
  clone: Element,
  box: { width: number; height: number },
) => Promise<string | null>;

/** Options for {@link createRasterizer}. */
export interface RasterizeOptions {
  /** Capture the whole document instead of just the target element (R16). */
  fullPage?: boolean;
}

/**
 * Build a `rasterize` fn for the {@link captureScreenshot} seam from an injected
 * low-level `serialize`. Clones the target (or documentElement for a full-page
 * shot), sanitizes the clone, and delegates. Matches the seam contract exactly:
 * returns `null` on ANY failure (missing DOM APIs, serialize throw/null, jsdom)
 * and NEVER throws, so a capture failure always degrades to the snapshot fallback
 * rather than blocking submit.
 */
export function createRasterizer(
  serialize: SerializeToImage,
  options: RasterizeOptions = {},
): (target: Element) => Promise<string | null> {
  return async (target: Element): Promise<string | null> => {
    try {
      const source = options.fullPage
        ? (target.ownerDocument?.documentElement ?? target)
        : target;
      if (typeof source.cloneNode !== "function") {
        return null;
      }
      const clone = source.cloneNode(true) as Element;
      sanitizeCaptureClone(clone);
      const rect =
        (target as unknown as { getBoundingClientRect?: () => DOMRect })
          .getBoundingClientRect?.() ?? { width: 0, height: 0 };
      return await serialize(clone, {
        width: rect.width,
        height: rect.height,
      });
    } catch {
      return null;
    }
  };
}
