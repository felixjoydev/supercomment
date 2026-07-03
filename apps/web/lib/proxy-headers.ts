/**
 * Header policy for the retained (flag-gated, dormant) tunnel reverse proxy in
 * apps/web/app/s/[slug]/[[...rest]]/route.ts.
 *
 * The tunnel origin is the DEVELOPER's machine — from a signed-in reviewer's
 * point of view it is a third party we must never hand credentials to. The proxy
 * therefore strips the reviewer's first-party auth before forwarding, so flipping
 * SUPERCOMMENT_ENABLE_TUNNEL (U10) back on can never leak a member session to a
 * developer-controlled tunnel (the plan-001 credential-leak bug). Kept as a pure,
 * exported module so the strip rules are unit-tested without importing
 * next/server or the Supabase runtime (proxy-header-strip.test.ts).
 */

/**
 * Hop-by-hop headers (RFC 7230 §6.1) plus `host`/`content-length`, which are
 * connection-scoped and must not survive a proxy hop. Reused for the upstream
 * RESPONSE headers too (route.ts), so it is exported.
 */
export const HOP_BY_HOP: ReadonlySet<string> = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade', 'host', 'content-length',
]);

/**
 * Credential / auth headers carrying the reviewer's first-party SuperComment
 * session. These must NEVER reach the tunnel origin:
 *   - `authorization` — a bearer token,
 *   - `cookie` — the Supabase auth session cookies, and
 *   - any `sb-*` header — Supabase auth/runtime headers (e.g. `sb-access-token`).
 * Match is case-insensitive (the caller lower-cases first).
 */
function isCredentialHeader(lowerKey: string): boolean {
  return (
    lowerKey === 'authorization' ||
    lowerKey === 'cookie' ||
    lowerKey.startsWith('sb-')
  );
}

/**
 * Build the request headers forwarded to the tunnel origin: drop hop-by-hop
 * headers and `accept-encoding` (so the upstream returns an un-encoded body we
 * can stream straight back), AND drop every credential header above. Everything
 * else passes through unchanged.
 */
export function buildForwardHeaders(source: Headers): Headers {
  const out = new Headers();
  source.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP.has(lower) || lower === 'accept-encoding') return;
    if (isCredentialHeader(lower)) return;
    out.set(key, value);
  });
  return out;
}

/**
 * Opaque-origin sandbox applied to every proxied tunnel RESPONSE. `sandbox`
 * with no `allow-same-origin` forces the browser to treat the document as a
 * UNIQUE origin, so its scripts cannot read the dashboard's cookies /
 * localStorage or make credentialed same-origin calls to the dashboard API —
 * neutralizing the H1 same-origin XSS even when a malicious tunnel serves
 * `text/html` + `<script>`. `allow-scripts allow-forms` keeps a genuine preview
 * usable; `allow-same-origin` is deliberately omitted (adding it would defeat
 * the isolation).
 */
export const TUNNEL_RESPONSE_CSP = 'sandbox allow-scripts allow-forms';

/**
 * Build the RESPONSE headers streamed back from the tunnel origin to the
 * reviewer's browser. Beyond hop-by-hop, this drops:
 *   - `set-cookie` / `set-cookie2` — a developer-controlled tunnel must not be
 *     able to set/overwrite cookies on the dashboard origin (the H1 `sb-*`
 *     session-fixation / cookie-overwrite vector), and
 *   - the upstream's own `content-security-policy*` — so it cannot relax the
 *     sandbox we impose.
 * It then forces the sandbox CSP + `nosniff`. Pure/exported so the strip + CSP
 * rules are unit-tested without next/server.
 */
export function buildTunnelResponseHeaders(upstream: Headers): Headers {
  const out = new Headers();
  upstream.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP.has(lower)) return;
    if (lower === 'set-cookie' || lower === 'set-cookie2') return;
    if (
      lower === 'content-security-policy' ||
      lower === 'content-security-policy-report-only'
    ) {
      return;
    }
    out.set(key, value);
  });
  out.set('content-security-policy', TUNNEL_RESPONSE_CSP);
  out.set('x-content-type-options', 'nosniff');
  return out;
}

/**
 * Strip the guest `?k=<link_secret>` param from a query string before it is
 * forwarded upstream, so the first-party link secret (validated at /s, never a
 * deploy-origin credential) never reaches the developer's tunnel. Preserves all
 * other params; returns a leading-`?`-prefixed string, or `''` when empty.
 */
export function stripLinkSecretFromSearch(search: string): string {
  const params = new URLSearchParams(
    search.startsWith('?') ? search.slice(1) : search,
  );
  params.delete('k');
  const rest = params.toString();
  return rest ? `?${rest}` : '';
}
