/**
 * Deploy-URL allowlist validator (shared, dependency-free).
 *
 * A preview's `deploy_url` becomes a REDIRECT TARGET at the embedded `/s` hop:
 * the reviewer is sent to `deploy_url#sc_token`. A malicious or internal
 * `deploy_url` would therefore be an open-redirect / token-theft / SSRF vector,
 * so the value is validated against this allowlist BEFORE it is ever stored
 * (register_deploy_target RPC) and trusted at redirect time (U2).
 *
 * This module is deliberately free of React / Next / Supabase / node imports —
 * it only uses the global WHATWG `URL` parser — so the same rules run in:
 *   - the dashboard client (instant UX feedback in link-manager.tsx),
 *   - the API route (defense in depth before the RPC),
 *   - U2's `/s` redirect (trusts the stored value, re-checks the allowlist).
 * The SECURITY DEFINER RPC in 0017_register_deploy_target.sql mirrors these
 * exact rules in SQL so the database is the authoritative boundary.
 *
 * ALLOWLIST RULES (v1):
 *   - https scheme only (reject http, data:, javascript:, file:, etc.).
 *   - no embedded credentials (`user:pass@host`).
 *   - reject IP-literal hosts (IPv4 in any notation, IPv6) — this also covers
 *     every private/loopback range (10/8, 172.16/12, 192.168/16, 127/8,
 *     169.254/16, ::1, fc00::/7, fe80::/10, …) since they are all IP literals.
 *   - reject `localhost` / `*.localhost` and `*.local` (mDNS) names.
 *   - require a dotted, non-numeric public host (a single-label / internal name
 *     like `intranet` is rejected).
 *   - otherwise accept any public https host.
 *
 * HARDENING FOLLOW-UP (intentionally NOT built now): a richer allowlist that
 * pins the host to known preview-CDN patterns (`*.vercel.app`, `*.netlify.app`,
 * `*.pages.dev`, `*.fly.dev`, `*.onrender.com`) or to a domain the workspace has
 * proven ownership of. v1 accepts any public https host; tightening this is an
 * explicit, separate increment.
 */

/** Why a candidate deploy URL was accepted or rejected. */
export type DeployUrlReason =
  | 'ok'
  | 'invalid-url'
  | 'not-https'
  | 'has-credentials'
  | 'ip-literal'
  | 'localhost'
  | 'mdns-local'
  | 'non-public-host';

export interface DeployUrlResult {
  ok: boolean;
  reason: DeployUrlReason;
  /** Human-readable explanation, suitable to surface in the dashboard. */
  message: string;
}

/** Exactly four dot-separated decimal groups, e.g. 127.0.0.1 / 192.168.1.10. */
const IPV4_DOTTED = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * Classify a candidate deploy URL against the allowlist, returning a machine
 * reason + a human message. `isAllowedDeployUrl` wraps this for a boolean.
 */
export function classifyDeployUrl(rawUrl: string): DeployUrlResult {
  const input = typeof rawUrl === 'string' ? rawUrl.trim() : '';
  if (!input) {
    return { ok: false, reason: 'invalid-url', message: 'Enter a deploy URL.' };
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return {
      ok: false,
      reason: 'invalid-url',
      message: 'That is not a valid absolute URL.',
    };
  }

  if (url.protocol !== 'https:') {
    return {
      ok: false,
      reason: 'not-https',
      message: 'Deploy URL must use https.',
    };
  }

  // Credentials in a deploy URL are never legitimate and are a phishing vector.
  if (url.username || url.password) {
    return {
      ok: false,
      reason: 'has-credentials',
      message: 'Deploy URL must not contain a username or password.',
    };
  }

  // WHATWG lowercases the host and normalizes every numeric IPv4 notation
  // (decimal/hex/short) to dotted-quad, and brackets IPv6 literals.
  const host = url.hostname;
  if (!host) {
    return {
      ok: false,
      reason: 'non-public-host',
      message: 'Deploy URL has no host.',
    };
  }

  // IPv6 literals are bracketed by the URL parser, e.g. "[::1]".
  if (host.startsWith('[')) {
    return {
      ok: false,
      reason: 'ip-literal',
      message: 'Deploy URL host must be a public domain, not an IP address.',
    };
  }

  if (host === 'localhost' || host.endsWith('.localhost')) {
    return {
      ok: false,
      reason: 'localhost',
      message: 'Deploy URL host must not be localhost.',
    };
  }

  if (host === 'local' || host.endsWith('.local')) {
    return {
      ok: false,
      reason: 'mdns-local',
      message: 'Deploy URL host must not be a .local (mDNS) name.',
    };
  }

  // A public host needs a dotted FQDN; a single-label name (e.g. "intranet")
  // is internal-only.
  if (!host.includes('.')) {
    return {
      ok: false,
      reason: 'non-public-host',
      message: 'Deploy URL host must be a public domain.',
    };
  }

  // Any all-numeric host: a dotted-quad IPv4, or a host whose final label is
  // purely numeric (real domains never have a numeric TLD; covers numeric IPv4
  // forms WHATWG could not collapse to a quad). Treated as an IP literal.
  const lastLabel = host.slice(host.lastIndexOf('.') + 1);
  if (IPV4_DOTTED.test(host) || /^\d+$/.test(lastLabel)) {
    return {
      ok: false,
      reason: 'ip-literal',
      message: 'Deploy URL host must be a public domain, not an IP address.',
    };
  }

  return { ok: true, reason: 'ok', message: 'Looks good.' };
}

/**
 * Whether `rawUrl` is an acceptable deploy target: a public https origin with no
 * IP literal / localhost / mDNS / credentials. The single source of truth for
 * the allowlist on the TS side (mirrored in SQL by register_deploy_target).
 */
export function isAllowedDeployUrl(rawUrl: string): boolean {
  return classifyDeployUrl(rawUrl).ok;
}
