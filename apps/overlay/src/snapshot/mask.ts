/**
 * Secret/PII masking for snapshots (U10).
 *
 * Two jobs:
 *  1. Mask user-entered values in form controls (input/textarea/select), with
 *     extra care for password fields — these can hold credentials a reviewer
 *     typed and must never be uploaded verbatim.
 *  2. Redact secret-SHAPED strings that appear in serialized text/attributes
 *     (tokens, API keys) regardless of where they came from.
 *
 * Patterns live HERE, in one place, and are exported so U13 can later
 * consolidate redaction across the codebase without re-deriving them. Treat
 * this module as the single source of truth for "what looks like a secret".
 */

export const REDACTION_PLACEHOLDER = '[redacted]';
export const MASKED_VALUE = '••••••';

/**
 * A named secret pattern. `name` is for diagnostics/consolidation; `regex` is
 * applied with the global flag when scanning free text. Keep each pattern
 * reasonably specific to avoid mangling ordinary prose.
 */
export interface SecretPattern {
  name: string;
  regex: RegExp;
}

/**
 * Ordered list of secret-shaped patterns. Order matters only for overlap; we
 * apply them sequentially. Each regex is authored WITHOUT the global flag and
 * cloned with `g` at apply time so callers can't trip over shared lastIndex.
 */
export const SECRET_PATTERNS: SecretPattern[] = [
  // HTTP Authorization Bearer header value.
  { name: 'bearer', regex: /Bearer\s+[A-Za-z0-9._\-+/=]{8,}/ },
  // JSON Web Token: three base64url segments separated by dots.
  {
    name: 'jwt',
    regex: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/,
  },
  // OpenAI-style secret key.
  { name: 'openai', regex: /\bsk-[A-Za-z0-9]{20,}\b/ },
  // GitHub personal access token (and similar gh* prefixes).
  { name: 'github-token', regex: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
  // AWS access key id.
  { name: 'aws-access-key', regex: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/ },
  // Slack token.
  { name: 'slack-token', regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  // Long hex blob (>=32 hex chars): hashes, raw keys, session ids.
  { name: 'long-hex', regex: /\b[0-9a-fA-F]{32,}\b/ },
];

/**
 * Redact every secret-shaped substring in `text`. Pure: returns a new string.
 * Non-secret text is left untouched.
 */
export function redactSecrets(text: string): string {
  if (!text) return text;
  let out = text;
  for (const { regex } of SECRET_PATTERNS) {
    const global = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : regex.flags + 'g');
    out = out.replace(global, REDACTION_PLACEHOLDER);
  }
  return out;
}

/** True when a string contains at least one secret-shaped substring. */
export function containsSecret(text: string): boolean {
  if (!text) return false;
  return SECRET_PATTERNS.some(({ regex }) => regex.test(text));
}

/** Tag names whose entered values we mask. */
const VALUE_BEARING_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/**
 * Attributes on a value-bearing control that we mask. We replace the `value`
 * attribute and any framework mirror of it, and strip autocomplete-y leakage.
 */
export interface MaskFieldInput {
  tag: string;
  /** Element attributes as already collected by the serializer. Mutated copy returned. */
  attributes: Record<string, string>;
}

/**
 * Given a serialized element's tag + attributes, return a masked attribute map
 * for form controls. Password fields are always masked; other value-bearing
 * controls have their `value` masked too (a reviewer may have typed PII). Pure.
 */
export function maskFieldAttributes(input: MaskFieldInput): Record<string, string> {
  const tag = input.tag.toUpperCase();
  if (!VALUE_BEARING_TAGS.has(tag)) {
    return input.attributes;
  }
  const attrs = { ...input.attributes };
  const isPassword =
    tag === 'INPUT' &&
    (attrs.type ?? '').toLowerCase() === 'password';

  // Mask the reflected value attribute if present.
  if ('value' in attrs) {
    attrs.value = isPassword ? MASKED_VALUE : MASKED_VALUE;
  }
  // Some frameworks mirror the value into data-* / aria-*; mask common ones.
  for (const key of Object.keys(attrs)) {
    if (key === 'placeholder') continue; // placeholders are not user data
    if (/^value$|defaultvalue/i.test(key)) {
      attrs[key] = MASKED_VALUE;
    }
  }
  return attrs;
}
