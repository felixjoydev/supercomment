/**
 * Embedded review-session — URL-fragment token read/strip (supabase-js-free).
 *
 * The single-use review token arrives in the location hash (`#sc_token=…`). These
 * pure helpers read it and strip it from the URL synchronously — BEFORE any
 * async step — so it never lingers in the URL for error reporters / Referer. Part
 * of the auth/session barrel (see ../session.ts).
 */

/** Fragment key carrying the single-use review token (mirrors buildEmbeddedRedirectUrl). */
export const REVIEW_TOKEN_HASH_KEY = "sc_token";

interface HashLike {
  hash: string;
}

interface LocationLike {
  pathname: string;
  search: string;
  hash: string;
}

interface HistoryLike {
  state?: unknown;
  replaceState(state: unknown, unused: string, url?: string | null): void;
}

/**
 * Read the review token from a location-like `{ hash }` SYNCHRONOUSLY. Handles a
 * bare `#sc_token=…` or a token mixed with other `&`-joined hash params (so a
 * hash-router app does not lose its own fragment). Returns the url-decoded token
 * or null when absent.
 */
export function readTokenFromHash(loc: HashLike): string | null {
  const raw = stripLeadingHash(loc?.hash ?? "");
  if (!raw) return null;
  for (const part of raw.split("&")) {
    const eq = part.indexOf("=");
    const key = eq === -1 ? part : part.slice(0, eq);
    if (key === REVIEW_TOKEN_HASH_KEY) {
      const value = eq === -1 ? "" : part.slice(eq + 1);
      const decoded = safeDecode(value);
      return decoded ? decoded : null;
    }
  }
  return null;
}

/**
 * Remove `sc_token` from the URL fragment via `history.replaceState`, preserving
 * pathname, query, and any other hash params. Best-effort: a missing/locked
 * History API leaves the URL unchanged rather than throwing.
 */
export function stripTokenFromHash(ctx: {
  location: LocationLike;
  history: HistoryLike;
}): void {
  const { location: loc, history } = ctx;
  const raw = stripLeadingHash(loc.hash ?? "");
  if (!raw) return;
  const kept = raw.split("&").filter((part) => {
    const eq = part.indexOf("=");
    const key = eq === -1 ? part : part.slice(0, eq);
    return key !== REVIEW_TOKEN_HASH_KEY;
  });
  const newHash = kept.length ? `#${kept.join("&")}` : "";
  const url = `${loc.pathname ?? ""}${loc.search ?? ""}${newHash}`;
  try {
    history.replaceState(history.state ?? null, "", url);
  } catch {
    // History unavailable (or cross-origin sandbox): leave the URL as-is.
  }
}

function stripLeadingHash(hash: string): string {
  return hash.startsWith("#") ? hash.slice(1) : hash;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
