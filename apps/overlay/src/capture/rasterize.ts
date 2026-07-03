/**
 * U6 — real screenshot capture: the capture sanitizer (security-critical).
 *
 * A raster of the modified DOM is an un-redactable channel to a third-party LLM
 * (the change-set text redactor cannot scrub a picture). Before anything is
 * serialized we blank user-typed content on a DETACHED CLONE — form field
 * values, password fields, textarea content — so a screenshot can never carry
 * typed secrets/PII (G1). The live DOM is never touched.
 *
 * `blankSensitiveField` is the single source of truth for that defense; the
 * live-DOM rasterizer (rasterize-live.ts) uses it as its per-cloned-node hook so
 * both capture paths scrub fields the SAME way.
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
 * Blank one node's user-typed content if it is a sensitive field — a textarea or
 * a text-bearing `<input>` (see {@link SENSITIVE_INPUT_TYPES}). No-ops for any
 * other node. Removes the reflected `value` property AND the `value` attribute
 * (real DOM→image serializers copy the live `.value` into a `value` attribute on
 * their clone, so both must go). A `type`-less input is treated as sensitive
 * (default is text). Best-effort, never throws.
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
