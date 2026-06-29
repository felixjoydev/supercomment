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
