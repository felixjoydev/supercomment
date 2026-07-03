/**
 * Sensitive-path blocking for the reverse proxy (U13 / R26).
 *
 * When a dev shares their running app through the proxy, a guest's browser (or a
 * curious visitor) can request ANY path the upstream serves — including files
 * that commonly leak secrets or debug internals: `.env` files, the `.git`
 * directory, JavaScript source maps (which can embed original source + comments),
 * SSH/cloud credentials, private keys, and framework debug / arbitrary-file-read
 * endpoints. This module decides which request paths the proxy refuses to
 * forward upstream at all.
 *
 * CANONICALIZATION (the H2 fix): the matcher must see the SAME path the upstream
 * will serve. A raw target like `/%2eenv`, `/%2egit/config`, `app.js%2emap`,
 * `/..%2f.env`, or `/.env%00.png` slips past a naive substring/basename check but
 * the dev server decodes `%2e`->`.`, `%2f`->`/`, `%00`->NUL and serves the real
 * `.env` / `.git/config` / source map. So we fully percent-decode (in a loop, to
 * defeat `%252e`-style double encoding), fold `\`->`/`, truncate at the first
 * control byte (kills the `%00` truncation trick), and collapse `.`/`..`/empty
 * segments BEFORE matching. `safeUpstreamPath` re-encodes that same canonical
 * path for the forward so the check and the forwarded request can never disagree.
 *
 * It is a configurable matcher: `isSensitivePath` blocks a conservative default
 * set, with an explicit allow-list carve-out for `/.well-known/` (used by ACME,
 * webauthn, security.txt, etc.) which lives under a dotted path but is public.
 *
 * This is defense-in-depth, NOT a substitute for the dev not serving secrets —
 * but blocking the well-known leak paths removes the easy wins.
 */

export interface SensitivePathOptions {
  /**
   * Extra path prefixes/patterns to treat as sensitive, beyond the defaults.
   * Each is matched as a case-insensitive substring of the canonical pathname.
   */
  extraBlockedPrefixes?: string[];
  /**
   * Allow-list prefixes that override blocking (case-insensitive prefix match
   * on the canonical pathname). Defaults include `/.well-known/`.
   */
  allowedPrefixes?: string[];
}

/** Prefixes that are always allowed even though they look dotted/internal. */
const DEFAULT_ALLOWED_PREFIXES = ["/.well-known/"];

/**
 * Recursively percent-decode until the string stops changing, so `%2e`, and even
 * `%252e` (which decodes to `%2e` then `.`), collapse to their literal form. A
 * malformed sequence makes `decodeURIComponent` throw — we stop and keep the last
 * good value rather than letting a bad escape pass through un-normalized. The
 * loop is bounded purely as a runaway guard; real inputs stabilize in 1-2 rounds.
 */
function fullyDecode(input: string): string {
  let current = input;
  for (let i = 0; i < 8; i++) {
    let next: string;
    try {
      next = decodeURIComponent(current);
    } catch {
      return current;
    }
    if (next === current) return current;
    current = next;
  }
  return current;
}

/**
 * Collapse `.`/`..`/empty segments of an absolute path (`..` never climbs above
 * root). Preserves a trailing slash so dir-vs-file semantics survive the forward.
 */
function collapseDotSegments(pathname: string): string {
  const hadTrailingSlash = pathname.length > 1 && pathname.endsWith("/");
  const out: string[] = [];
  for (const segment of pathname.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      out.pop();
      continue;
    }
    out.push(segment);
  }
  let result = "/" + out.join("/");
  if (hadTrailingSlash && result !== "/") result += "/";
  return result;
}

/**
 * Split a request target into its pathname and the verbatim query+fragment
 * suffix (which we never rewrite). Tolerates absolute URLs and relative targets.
 */
function splitTarget(input: string): { pathname: string; suffix: string } {
  let path = input || "/";
  try {
    if (/^https?:\/\//i.test(path)) {
      const url = new URL(path);
      path = url.pathname + url.search + url.hash;
    }
  } catch {
    /* not a parseable absolute URL — treat the raw string as a path */
  }
  const q = path.indexOf("?");
  const h = path.indexOf("#");
  let cut = -1;
  if (q === -1) cut = h;
  else if (h === -1) cut = q;
  else cut = Math.min(q, h);

  let suffix = "";
  if (cut !== -1) {
    suffix = path.slice(cut);
    path = path.slice(0, cut);
  }
  return { pathname: path, suffix };
}

/**
 * Decode + normalize a raw pathname to the canonical form the upstream will
 * actually resolve: `\`->`/`, full percent-decode, control-byte truncation, and
 * `.`/`..` collapse. Original case is preserved (paths can be case-sensitive
 * upstream); callers lower-case for matching.
 */
function canonicalizePathname(rawPathname: string): string {
  let path = rawPathname.replace(/\\/g, "/");
  path = fullyDecode(path);
  // Decoding may have revealed `%5c`-encoded backslashes; fold those too.
  path = path.replace(/\\/g, "/");
  // Truncate at the first control byte (NUL etc.) so `/.env%00.png` -> `/.env`.
  const control = path.search(/[\u0000-\u001f\u007f]/);
  if (control !== -1) path = path.slice(0, control);
  if (!path.startsWith("/")) path = "/" + path;
  return collapseDotSegments(path);
}

/** The canonical pathname, lower-cased, for case-insensitive matching. */
function pathnameForMatch(input: string): string {
  return canonicalizePathname(splitTarget(input).pathname).toLowerCase();
}

/** The last path segment. */
function basenameOf(pathname: string): string {
  const segments = pathname.split("/");
  return segments[segments.length - 1] ?? "";
}

/** True iff any path segment is exactly `segment` (case-insensitive). */
function hasSegment(pathname: string, segment: string): boolean {
  return pathname.split("/").includes(segment);
}

/**
 * The canonical, re-encoded path (plus verbatim query/fragment) to forward
 * upstream, so the proxy fetches exactly the path `isSensitivePath` inspected —
 * a request cannot be checked as one path and served as another. `encodeURI`
 * re-encodes spaces / non-ASCII while leaving legitimate path structure intact,
 * and is a no-op for ordinary paths.
 */
export function safeUpstreamPath(input: string): string {
  const { pathname, suffix } = splitTarget(input);
  return encodeURI(canonicalizePathname(pathname)) + suffix;
}

/**
 * Return true if the request path should be BLOCKED (returned a 404 without
 * proxying upstream). Matching is on the CANONICAL path (see module header), so
 * percent-encoded / traversal / trailing-dot variants are blocked too. Default
 * blocked set:
 *   - `.env` and any `.env.*` (e.g. `.env.local`, `.env.production`)
 *   - VCS metadata dirs: `.git/`, `.hg/`, `.svn/` (and a bare `/.git`)
 *   - source maps (`*.map`)
 *   - framework debug: Next.js `/__nextjs_*`; Vite `/@fs/`, `/@id/` (arbitrary read)
 *   - credential dotfiles: `.npmrc`, `.netrc`, `.htpasswd`, `.git-credentials`
 *   - credential dirs: `.ssh`, `.aws`, `.gnupg`, `.kube` (as a whole segment)
 *   - private keys / certs: `*.pem`, `*.key`, `*.pfx`, `*.p12`, `*.keystore`
 *   - backup / editor / swap files: `*~`, `*.bak`, `*.orig`, `*.save`, `*.swp`,
 *     `*.swo`, and `.DS_Store`
 * Allowed despite looking internal: `/.well-known/` (and any caller-provided
 * allow prefixes).
 */
export function isSensitivePath(
  input: string,
  options: SensitivePathOptions = {},
): boolean {
  const pathname = pathnameForMatch(input);
  const allowed = [
    ...DEFAULT_ALLOWED_PREFIXES,
    ...(options.allowedPrefixes ?? []),
  ].map((p) => p.toLowerCase());
  for (const prefix of allowed) {
    if (pathname.startsWith(prefix)) {
      return false;
    }
  }

  // Strip trailing dots/spaces (Windows drops them, so `.env.` / `.env%20` both
  // resolve to `.env` upstream). Keep the raw basename if it was ALL dots/spaces.
  const rawBase = basenameOf(pathname);
  const base = rawBase.replace(/[. ]+$/, "") || rawBase;

  // .env and .env.* (exact basename match so `prevent.env-leak` is not blocked).
  if (base === ".env" || base.startsWith(".env.")) {
    return true;
  }

  // VCS metadata directories or a bare request for one.
  if (
    pathname.includes("/.git/") ||
    pathname === "/.git" ||
    base === ".git" ||
    pathname.includes("/.hg/") ||
    pathname.includes("/.svn/") ||
    base === ".hg" ||
    base === ".svn"
  ) {
    return true;
  }

  // Source maps.
  if (base.endsWith(".map")) {
    return true;
  }

  // Framework debug / arbitrary-file-read endpoints.
  if (
    pathname.startsWith("/__nextjs_") ||
    pathname.startsWith("/@fs/") ||
    pathname === "/@fs" ||
    pathname.startsWith("/@id/")
  ) {
    return true;
  }

  // Credential / config dotfiles.
  if (
    base === ".npmrc" ||
    base === ".netrc" ||
    base === ".htpasswd" ||
    base === ".git-credentials"
  ) {
    return true;
  }

  // Credential directories addressed as a whole segment (`/.ssh/id_rsa`, etc.).
  if (
    hasSegment(pathname, ".ssh") ||
    hasSegment(pathname, ".aws") ||
    hasSegment(pathname, ".gnupg") ||
    hasSegment(pathname, ".kube")
  ) {
    return true;
  }

  // Private keys / certificates / keystores.
  if (
    base.endsWith(".pem") ||
    base.endsWith(".key") ||
    base.endsWith(".pfx") ||
    base.endsWith(".p12") ||
    base.endsWith(".keystore")
  ) {
    return true;
  }

  // Backup / editor / swap files.
  if (
    base.endsWith("~") ||
    base.endsWith(".bak") ||
    base.endsWith(".orig") ||
    base.endsWith(".save") ||
    base.endsWith(".swp") ||
    base.endsWith(".swo") ||
    base === ".ds_store"
  ) {
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
