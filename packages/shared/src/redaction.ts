/**
 * Canonical secret/PII redaction (U13).
 *
 * This is the SINGLE source of truth for "what looks like a secret" across the
 * whole codebase. The overlay snapshot masker (apps/overlay/src/snapshot/mask.ts)
 * and the context capturers (surrounding HTML, console messages) all delegate
 * their free-text redaction here so a token, key, JWT, or PII string is scrubbed
 * the same way no matter where it was captured.
 *
 * Design notes (research-confirmed, OWASP / gitleaks / TruffleHog style):
 *   - Regex + light entropy heuristics catch the common shapes of leaked
 *     credentials (Bearer headers, JWTs, cloud keys, provider tokens, long hex,
 *     and high-entropy base64-ish blobs). This is defense-in-depth, NOT a
 *     guarantee — no tool achieves full coverage, so we redact client-side at
 *     capture AND in a server pass.
 *   - Basic email matching covers the most common PII shape. Heavier PII
 *     detection (Presidio / OCR) is a server/operational concern, out of scope
 *     for this pure module.
 *   - Every pattern is authored WITHOUT the global flag and cloned with `g` at
 *     apply time so callers never trip over a shared `lastIndex`.
 *   - `redactSecrets` is idempotent: the placeholder contains no secret-shaped
 *     substring, so re-running over already-redacted text is a no-op.
 */

import type { CapturedContext, ChangeOp, VisualChangeSet } from "./schema.js";

/** What we substitute in place of a detected secret/PII run. */
export const REDACTION_PLACEHOLDER = "[redacted]";

/**
 * A named secret pattern. `name` is for diagnostics + audit; `regex` is applied
 * with the global flag when scanning free text. Keep each pattern reasonably
 * specific so ordinary prose is left intact.
 */
export interface SecretPattern {
  name: string;
  regex: RegExp;
}

/**
 * Ordered list of secret-shaped patterns. Order matters only for overlap; we
 * apply them sequentially. More-specific provider patterns come before the
 * broad entropy/hex catch-alls so the diagnostics name the precise kind first.
 */
export const SECRET_PATTERNS: SecretPattern[] = [
  // HTTP Authorization Bearer header value (the token after "Bearer ").
  { name: "bearer", regex: /Bearer\s+[A-Za-z0-9._\-+/=]{8,}/ },
  // JSON Web Token: three base64url segments separated by dots.
  {
    name: "jwt",
    regex: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/,
  },
  // OpenAI-style secret key.
  { name: "openai", regex: /\bsk-[A-Za-z0-9]{20,}\b/ },
  // GitHub tokens: classic PAT (ghp_), OAuth (gho_), and the other gh* prefixes
  // (user-to-server ghu_, server-to-server ghs_, refresh ghr_).
  { name: "github-token", regex: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
  // AWS access key id (long-term AKIA, temporary ASIA).
  { name: "aws-access-key", regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  // AWS secret access key shape: a 40-char base64-ish blob explicitly labeled.
  {
    name: "aws-secret-key",
    regex:
      /\baws_secret_access_key\b\s*[:=]\s*["']?[A-Za-z0-9/+=]{40}["']?/i,
  },
  // Slack token.
  { name: "slack-token", regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  // Email address (basic PII).
  {
    name: "email",
    regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/,
  },
  // Long hex blob (>=32 hex chars): hashes, raw keys, session ids.
  { name: "long-hex", regex: /\b[0-9a-fA-F]{32,}\b/ },
  // High-entropy base64/base64url run (>=32 chars). This is the gitleaks-style
  // catch-all for generic secrets; the entropy gate (below) avoids redacting
  // long-but-low-entropy strings such as repeated characters or plain words.
  { name: "high-entropy-base64", regex: /\b[A-Za-z0-9+/_-]{32,}={0,2}\b/ },
];

/** Patterns whose match is only redacted when it passes the entropy gate. */
const ENTROPY_GATED = new Set(["high-entropy-base64"]);

/**
 * Shannon entropy (bits per character) of a string. High-entropy strings look
 * random (keys/tokens); low-entropy strings look like words/repeats. Pure.
 */
export function shannonEntropy(value: string): number {
  if (!value) return 0;
  const counts = new Map<string, number>();
  for (const ch of value) {
    counts.set(ch, (counts.get(ch) ?? 0) + 1);
  }
  let entropy = 0;
  const length = value.length;
  for (const count of counts.values()) {
    const p = count / length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/**
 * Minimum bits/char for the generic base64 catch-all to count as a secret.
 * ~3.5 bits keeps ordinary long identifiers (e.g. "aaaaaaaa...", lowercase
 * sentences-without-spaces) below the line while real base64 keys (which mix
 * case + digits + symbols, ~4.5-6 bits) are caught.
 */
const ENTROPY_THRESHOLD = 3.5;

/** A regex cloned with the global flag (preserving any existing flags). */
function global(regex: RegExp): RegExp {
  return regex.flags.includes("g")
    ? new RegExp(regex.source, regex.flags)
    : new RegExp(regex.source, regex.flags + "g");
}

/**
 * Redact every secret-shaped substring in `text`. Pure: returns a new string,
 * leaving non-secret text untouched. Idempotent — running it again is a no-op
 * because the placeholder contains nothing secret-shaped.
 */
export function redactSecrets(text: string): string {
  if (!text) return text;
  let out = text;
  for (const { name, regex } of SECRET_PATTERNS) {
    if (ENTROPY_GATED.has(name)) {
      out = out.replace(global(regex), (match) =>
        shannonEntropy(match) >= ENTROPY_THRESHOLD ? REDACTION_PLACEHOLDER : match,
      );
    } else {
      out = out.replace(global(regex), REDACTION_PLACEHOLDER);
    }
  }
  return out;
}

/**
 * Redact secret/PII-shaped runs from a single visual change-set op's FREE-TEXT
 * (U8): the before/after values, the nearest design token, the font-identity
 * family/raw-stack (U7), and any inserted-node text or attribute values.
 * Structure — op type, target selector/anchors/source, property name, font
 * source/weights, breakpoint/state — is untouched (it carries no free text).
 * Returns a NEW op; pure + idempotent.
 */
function redactOp(op: ChangeOp): ChangeOp {
  const next: ChangeOp = { ...op };
  if (typeof next.before === "string") next.before = redactSecrets(next.before);
  if (typeof next.after === "string") next.after = redactSecrets(next.after);
  if (next.valueToken) next.valueToken = redactSecrets(next.valueToken);
  // Font identity carries reviewer-typed free text (a family name, the raw
  // computed stack) — scrub it like any other value (U7). Structure (source,
  // weights, fileRef) is enumerated / a storage ref and stays intact.
  if (next.font) {
    const font = { ...next.font };
    font.family = redactSecrets(font.family);
    if (typeof font.rawStack === "string") font.rawStack = redactSecrets(font.rawStack);
    next.font = font;
  }
  if (next.node) {
    const node = { ...next.node };
    if (typeof node.text === "string") node.text = redactSecrets(node.text);
    if (node.attrs) {
      const attrs: Record<string, string> = {};
      for (const [k, v] of Object.entries(node.attrs)) {
        attrs[k] = redactSecrets(v);
      }
      node.attrs = attrs;
    }
    next.node = node;
  }
  return next;
}

/**
 * Redact a whole visual change-set's free-text (U8). Returns a NEW change-set
 * with every op's values scrubbed; anchors + structure preserved. Pure.
 */
export function redactChangeSet(changeSet: VisualChangeSet): VisualChangeSet {
  return { ...changeSet, ops: changeSet.ops.map(redactOp) };
}

/**
 * Redact the reviewer-authored change-set free-text a comment carries (U8),
 * returning a NEW context. This is the server/trusted-side pass the redaction
 * docstring assumes exists: applied at the MCP delivery boundary (the untrusted
 * -input sink), it scrubs a token typed into an edit before it can reach the
 * agent even if a malicious client skipped the client-side redaction. Other
 * context free-text (surrounding HTML, console) is already redacted at capture.
 */
export function redactContextChangeSet(
  context: CapturedContext,
): CapturedContext {
  if (!context.changeSet) return context;
  return { ...context, changeSet: redactChangeSet(context.changeSet) };
}

/** True when a string contains at least one secret-/PII-shaped substring. */
export function containsSecret(text: string): boolean {
  if (!text) return false;
  for (const { name, regex } of SECRET_PATTERNS) {
    if (ENTROPY_GATED.has(name)) {
      const m = text.match(global(regex));
      if (m && m.some((s) => shannonEntropy(s) >= ENTROPY_THRESHOLD)) {
        return true;
      }
    } else if (regex.test(text)) {
      return true;
    }
  }
  return false;
}
