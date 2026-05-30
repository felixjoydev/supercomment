/**
 * Sensitive-path blocking for the reverse proxy (U13 / R26).
 *
 * When a dev shares their running app through the proxy, a guest's browser (or a
 * curious visitor) can request ANY path the upstream serves — including files
 * that commonly leak secrets or debug internals: `.env` files, the `.git`
 * directory, JavaScript source maps (which can embed original source + comments),
 * and framework debug endpoints. This module decides which request paths the
 * proxy refuses to forward upstream at all.
 *
 * It is a configurable matcher: `isSensitivePath` blocks a conservative default
 * set, with an explicit allow-list carve-out for `/.well-known/` (used by ACME,
 * webauthn, security.txt, etc.) which lives under a dotted path but is meant to
 * be public.
 *
 * This is defense-in-depth, NOT a substitute for the dev not serving secrets —
 * but blocking the well-known leak paths removes the easy wins.
 */

export interface SensitivePathOptions {
  /**
   * Extra path prefixes/patterns to treat as sensitive, beyond the defaults.
   * Each is matched as a case-insensitive substring of the pathname.
   */
  extraBlockedPrefixes?: string[];
  /**
   * Allow-list prefixes that override blocking (case-insensitive prefix match
   * on the pathname). Defaults include `/.well-known/`.
   */
  allowedPrefixes?: string[];
}

/** Prefixes that are always allowed even though they look dotted/internal. */
const DEFAULT_ALLOWED_PREFIXES = ["/.well-known/"];

/**
 * Extract just the pathname from a request URL/target, lowercased, without the
 * query string or fragment. Tolerates absolute and relative forms.
 */
function pathnameOf(input: string): string {
  let path = input || "/";
  // Strip scheme+host if an absolute URL was passed.
  try {
    if (/^https?:\/\//i.test(path)) {
      path = new URL(path).pathname;
    }
  } catch {
    /* fall through with the raw string */
  }
  // Drop query and fragment.
  const q = path.indexOf("?");
  if (q !== -1) path = path.slice(0, q);
  const h = path.indexOf("#");
  if (h !== -1) path = path.slice(0, h);
  if (!path.startsWith("/")) path = "/" + path;
  return path.toLowerCase();
}

/** The basename (last segment) of a pathname. */
function basenameOf(pathname: string): string {
  const segments = pathname.split("/");
  return segments[segments.length - 1] ?? "";
}

/**
 * Return true if the request path should be BLOCKED (returned a 404 without
 * proxying upstream). Default blocked set:
 *   - `.env` and any `.env.*` (e.g. `.env.local`, `.env.production`)
 *   - anything inside a `.git/` directory (and a bare `/.git`)
 *   - JavaScript/CSS source maps (`*.map`)
 *   - Next.js debug endpoints (`/__nextjs_*`)
 *   - any other segment that is exactly `.git` or a dotfile env file
 * Allowed despite looking internal: `/.well-known/` (and any caller-provided
 * allow prefixes).
 */
export function isSensitivePath(
  input: string,
  options: SensitivePathOptions = {},
): boolean {
  const pathname = pathnameOf(input);
  const allowed = [
    ...DEFAULT_ALLOWED_PREFIXES,
    ...(options.allowedPrefixes ?? []),
  ].map((p) => p.toLowerCase());
  for (const prefix of allowed) {
    if (pathname.startsWith(prefix)) {
      return false;
    }
  }

  const base = basenameOf(pathname);

  // .env and .env.* (exact basename match so `prevent.env-leak` style paths
  // are not falsely blocked).
  if (base === ".env" || base.startsWith(".env.")) {
    return true;
  }

  // .git directory contents or a bare .git request.
  if (pathname.includes("/.git/") || pathname === "/.git" || base === ".git") {
    return true;
  }

  // Source maps.
  if (base.endsWith(".map")) {
    return true;
  }

  // Next.js debug/stack-frame endpoints.
  if (pathname.startsWith("/__nextjs_")) {
    return true;
  }

  // Caller-provided extra prefixes (substring, case-insensitive).
  for (const extra of options.extraBlockedPrefixes ?? []) {
    if (pathname.includes(extra.toLowerCase())) {
      return true;
    }
  }

  return false;
}
