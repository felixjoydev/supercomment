/**
 * CSP header rewrite helper (U3).
 *
 * When the upstream dev server emits a Content-Security-Policy, the injected
 * overlay <script> (which carries a nonce) and the overlay's network calls to
 * the SuperComment backend would otherwise be blocked. This helper rewrites the
 * policy minimally and safely:
 *
 *   - Add the overlay nonce to `script-src` so the injected <script nonce="...">
 *     is allowed. We NEVER add `'unsafe-inline'` — that would weaken the host
 *     app's policy far beyond what we need.
 *   - Add the backend origin to `connect-src` so the overlay can POST comments /
 *     open the realtime channel.
 *
 * Notes / edge cases handled:
 *   - `strict-dynamic`: when present in `script-src`, browsers ignore host-source
 *     and nonce/hash allow-listing of *non-script-inserted* scripts is governed
 *     by the nonce. Our nonce is still honored for the top-level injected tag, so
 *     adding the nonce is correct and sufficient; we do not strip strict-dynamic.
 *   - If the directive is missing but a `default-src` exists, CSP falls back to
 *     default-src, so we materialize an explicit `script-src` / `connect-src`
 *     seeded from default-src before appending our additions (otherwise our
 *     nonce/origin would be the *only* allowed source, breaking the app).
 *   - If there is no CSP at all, we do nothing (caller skips invoking us).
 *   - Both `Content-Security-Policy` and `...-Report-Only` are handled by the
 *     caller passing whichever header value is present.
 *
 * This is pure string logic so it is trivially unit-testable.
 */

export interface CspRewriteOptions {
  /** The nonce that will be placed on the injected <script nonce="..."> tag. */
  nonce: string;
  /**
   * The backend origin the overlay talks to (e.g. "https://app.example.com").
   * Added to connect-src. Optional — when omitted, only script-src is touched.
   */
  connectOrigin?: string;
}

/** Directives, in order, parsed from a CSP header value. */
type Directives = Array<{ name: string; sources: string[] }>;

function parseCsp(headerValue: string): Directives {
  return headerValue
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => {
      const tokens = part.split(/\s+/);
      const name = (tokens.shift() ?? '').toLowerCase();
      return { name, sources: tokens };
    })
    .filter((d) => d.name.length > 0);
}

function serializeCsp(directives: Directives): string {
  return directives
    .map((d) => (d.sources.length > 0 ? `${d.name} ${d.sources.join(' ')}` : d.name))
    .join('; ');
}

function findDirective(directives: Directives, name: string) {
  return directives.find((d) => d.name === name);
}

/** A nonce source token, e.g. `'nonce-abc123'`. */
function nonceSource(nonce: string): string {
  return `'nonce-${nonce}'`;
}

/**
 * Ensure a directive exists, materializing it from `default-src` when absent so
 * that adding our source does not accidentally become the *only* allowed source.
 * Returns the (possibly newly created) directive.
 */
function ensureDirective(directives: Directives, name: string): { name: string; sources: string[] } {
  const existing = findDirective(directives, name);
  if (existing) return existing;

  const fallback = findDirective(directives, 'default-src');
  const seeded = fallback ? [...fallback.sources] : [];
  const created = { name, sources: seeded };
  directives.push(created);
  return created;
}

/**
 * Rewrite a CSP header value to allow the overlay nonce (script-src) and,
 * optionally, the backend origin (connect-src). Returns the rewritten value.
 *
 * Idempotent: re-running with the same nonce/origin won't duplicate tokens.
 */
export function rewriteCsp(headerValue: string, options: CspRewriteOptions): string {
  const directives = parseCsp(headerValue);

  // script-src: add the nonce (never 'unsafe-inline').
  const scriptSrc = ensureDirective(directives, 'script-src');
  const token = nonceSource(options.nonce);
  if (!scriptSrc.sources.includes(token)) {
    scriptSrc.sources.push(token);
  }

  // connect-src: add the backend origin so the overlay can reach the API/WS.
  if (options.connectOrigin) {
    const connectSrc = ensureDirective(directives, 'connect-src');
    if (!connectSrc.sources.includes(options.connectOrigin)) {
      connectSrc.sources.push(options.connectOrigin);
    }
  }

  return serializeCsp(directives);
}

/**
 * Header names we rewrite. We touch enforced and report-only equally; the caller
 * iterates whichever are present on the upstream response.
 */
export const CSP_HEADER_NAMES = [
  'content-security-policy',
  'content-security-policy-report-only',
] as const;
