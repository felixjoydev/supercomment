/**
 * Secret/PII masking for snapshots (U10), consolidated under U13.
 *
 * Two jobs:
 *  1. Mask user-entered values in form controls (input/textarea/select) — a
 *     reviewer may have typed credentials or PII that must never be uploaded.
 *  2. Redact secret-SHAPED strings in serialized text/attributes (tokens, keys,
 *     PII) regardless of origin.
 *
 * U13 change: the secret-pattern definitions + free-text redaction now live in
 * the canonical shared module (`@supercomment/shared` → redaction.ts). This file
 * DELEGATES job (2) by re-exporting those symbols (single source of truth, no
 * drifting copy) and keeps the snapshot-specific form-control masking (job 1).
 */

export {
  redactSecrets,
  containsSecret,
  SECRET_PATTERNS,
  REDACTION_PLACEHOLDER,
  type SecretPattern,
} from "@supercomment/shared";

/** Placeholder used for masked form-control values (distinct from redaction). */
export const MASKED_VALUE = "••••••";

/** Tag names whose entered values we mask. */
const VALUE_BEARING_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

export interface MaskFieldInput {
  tag: string;
  /** Element attributes already collected by the serializer. A copy is returned. */
  attributes: Record<string, string>;
}

/**
 * Given a serialized element's tag + attributes, return a masked attribute map
 * for form controls. Password fields and every other value-bearing control have
 * their `value` (and any mirrored value attribute) masked — a reviewer may have
 * typed PII into a plain text input. Non-value-bearing elements pass through
 * untouched. Pure.
 */
export function maskFieldAttributes(
  input: MaskFieldInput,
): Record<string, string> {
  const tag = input.tag.toUpperCase();
  if (!VALUE_BEARING_TAGS.has(tag)) {
    return input.attributes;
  }
  const attrs = { ...input.attributes };

  if ("value" in attrs) {
    attrs.value = MASKED_VALUE;
  }
  // Some frameworks mirror the value into data-value / defaultValue; mask those
  // too. Placeholders are not user data and are preserved.
  for (const key of Object.keys(attrs)) {
    if (key === "placeholder") continue;
    if (/^value$|defaultvalue/i.test(key)) {
      attrs[key] = MASKED_VALUE;
    }
  }
  return attrs;
}
