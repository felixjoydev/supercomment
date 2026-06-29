/**
 * Embedded review-mode session lifecycle (U3) — supabase-js-FREE.
 *
 * The overlay is shipped as a single self-contained IIFE injected into the
 * customer's deploy origin. It must NOT pull in @supabase/supabase-js (bloat +
 * collision risk with a host app that already ships it), so every network step
 * here is a raw `fetch` (anon sign-in, token exchange, refresh). All seams are
 * injectable so the pure parts (hash read/strip, persist/restore, expiry) are
 * unit-tested in node/jsdom and the live network is isolated.
 *
 * FLOW on the deploy origin (see index.ts for the orchestration):
 *   1. SYNCHRONOUSLY read `#sc_token=<token>` from the hash, then immediately
 *      `history.replaceState` to strip it — BEFORE any async/await — so it never
 *      lingers in the URL for error reporters / Referer.
 *   2. Anonymous sign-in (POST /auth/v1/signup) → anon access/refresh JWT.
 *   3. Exchange the token (POST /api/review-token/exchange, anon bearer) →
 *      { previewId, role, displayName }.
 *   4. Persist { tokens, previewId, role, displayName, expiresAt } in
 *      sessionStorage (reload — which triggers redeploy-reconcile — restores it
 *      with no token in the URL) and mount.
 *   5. Refresh (POST /auth/v1/token?grant_type=refresh_token) before a write
 *      when the access token is near expiry.
 *
 * VERIFY IN REAL ENV: the live Supabase anon sign-in + refresh endpoints, the
 * cross-origin exchange POST (CORS), and the exact auth response shape cannot be
 * exercised in this sandbox; they are isolated behind the `fetchImpl` seam.
 */

/** Fragment key carrying the single-use review token (mirrors buildEmbeddedRedirectUrl). */
export const REVIEW_TOKEN_HASH_KEY = "sc_token";

/**
 * sessionStorage key for the persisted session. sessionStorage is per-origin, so
 * one deploy origin (= one preview in this model) stores one current session;
 * the value carries `previewId` for server-scoped reads/writes.
 */
export const REVIEW_SESSION_STORAGE_KEY = "supercomment:review-session";

/** Refresh the access token when it is within this window of expiry. */
export const REFRESH_SKEW_MS = 60_000;

/** What we persist across reloads (sessionStorage). */
export interface PersistedSession {
  accessToken: string;
  refreshToken: string;
  previewId: string;
  role: string;
  displayName: string;
  /** Epoch milliseconds when the access token expires. */
  expiresAt: number;
}

/** Result of an anon sign-in / refresh (tokens normalised to epoch-ms expiry). */
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  /** The anon user id (JWT `sub`). */
  userId: string;
  expiresAt: number;
}

/** Outcome of a token exchange. */
export interface ExchangeResult {
  previewId: string;
  role: string;
  displayName: string;
}

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

/** Minimal storage surface (sessionStorage) so persistence is testable. */
export interface SessionStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

type FetchLike = typeof fetch;

// ---------------------------------------------------------------------------
// Pure helpers — token read / strip
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Pure helpers — persistence
// ---------------------------------------------------------------------------

export function persistSession(
  session: PersistedSession,
  storage: SessionStorageLike = defaultStorage(),
): void {
  try {
    storage.setItem(REVIEW_SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Quota / privacy mode: the session simply won't survive a reload.
  }
}

export function restoreSession(
  storage: SessionStorageLike = defaultStorage(),
): PersistedSession | null {
  let raw: string | null = null;
  try {
    raw = storage.getItem(REVIEW_SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isValidSession(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function clearSession(
  storage: SessionStorageLike = defaultStorage(),
): void {
  try {
    storage.removeItem(REVIEW_SESSION_STORAGE_KEY);
  } catch {
    // ignore
  }
}

/**
 * True when `expiresAt` (epoch ms) is at/before `now` (optionally minus a skew
 * window so a near-expiry token is treated as expired and refreshed proactively).
 * A non-finite `expiresAt` is treated as expired (fail closed).
 */
export function isExpired(
  expiresAt: number,
  now: number = Date.now(),
  skewMs = 0,
): boolean {
  if (!Number.isFinite(expiresAt)) return true;
  return expiresAt - skewMs <= now;
}

// ---------------------------------------------------------------------------
// Network steps (injectable fetch seam) — VERIFY IN REAL ENV
// ---------------------------------------------------------------------------

/**
 * Anonymous Supabase sign-in. Supabase implements anonymous sign-in as a
 * credential-less signup: POST `${supabaseUrl}/auth/v1/signup` with the anon
 * `apikey` header and an empty body. Returns the anon session tokens + uid.
 */
export async function anonSignIn(cfg: {
  supabaseUrl: string;
  anonKey: string;
  fetchImpl?: FetchLike;
}): Promise<AuthTokens> {
  const base = trimSlash(cfg.supabaseUrl);
  const fetchImpl = cfg.fetchImpl ?? fetch;
  const res = await fetchImpl(`${base}/auth/v1/signup`, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: cfg.anonKey },
    body: "{}",
  });
  if (!res.ok) {
    throw new Error(`anon_sign_in_failed_${res.status}`);
  }
  return normalizeTokens((await res.json()) as AuthResponse);
}

/**
 * Exchange the single-use review token for a preview-scoped session. POSTs to
 * the SuperComment backend (cross-origin) with the anon access token as the
 * bearer + the token in the body. The server verifies the JWT and consumes the
 * token (establish_review_session).
 */
export async function exchangeReviewToken(cfg: {
  backendOrigin: string;
  accessToken: string;
  token: string;
  fetchImpl?: FetchLike;
}): Promise<ExchangeResult> {
  const base = trimSlash(cfg.backendOrigin);
  const fetchImpl = cfg.fetchImpl ?? fetch;
  const res = await fetchImpl(`${base}/api/review-token/exchange`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${cfg.accessToken}`,
    },
    body: JSON.stringify({ token: cfg.token }),
  });
  if (!res.ok) {
    throw new Error(`exchange_failed_${res.status}`);
  }
  const data = (await res.json()) as Partial<ExchangeResult>;
  if (!data || typeof data.previewId !== "string" || !data.previewId) {
    throw new Error("exchange_missing_preview");
  }
  return {
    previewId: data.previewId,
    role: typeof data.role === "string" ? data.role : "guest",
    displayName:
      typeof data.displayName === "string" && data.displayName
        ? data.displayName
        : "Guest",
  };
}

/**
 * Refresh the anon access token. POST `${supabaseUrl}/auth/v1/token?grant_type=
 * refresh_token` with the anon `apikey` header + the refresh token. Returns a
 * fresh token set.
 */
export async function refreshAccessToken(cfg: {
  supabaseUrl: string;
  anonKey: string;
  refreshToken: string;
  fetchImpl?: FetchLike;
}): Promise<AuthTokens> {
  const base = trimSlash(cfg.supabaseUrl);
  const fetchImpl = cfg.fetchImpl ?? fetch;
  const res = await fetchImpl(
    `${base}/auth/v1/token?grant_type=refresh_token`,
    {
      method: "POST",
      headers: { "content-type": "application/json", apikey: cfg.anonKey },
      body: JSON.stringify({ refresh_token: cfg.refreshToken }),
    },
  );
  if (!res.ok) {
    throw new Error(`refresh_failed_${res.status}`);
  }
  return normalizeTokens((await res.json()) as AuthResponse);
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** The subset of the GoTrue auth response we consume. */
interface AuthResponse {
  access_token?: string;
  refresh_token?: string;
  /** Seconds-until-expiry. */
  expires_in?: number;
  /** Absolute expiry, epoch seconds. */
  expires_at?: number;
  user?: { id?: string } | null;
}

function normalizeTokens(data: AuthResponse): AuthTokens {
  const accessToken = data.access_token;
  const refreshToken = data.refresh_token;
  if (!accessToken || !refreshToken) {
    throw new Error("auth_response_missing_tokens");
  }
  return {
    accessToken,
    refreshToken,
    userId: data.user?.id ?? "",
    expiresAt: computeExpiresAt(data),
  };
}

function computeExpiresAt(data: AuthResponse): number {
  if (typeof data.expires_at === "number") return data.expires_at * 1000;
  if (typeof data.expires_in === "number") {
    return Date.now() + data.expires_in * 1000;
  }
  // Conservative default: Supabase access tokens are 1h by default.
  return Date.now() + 3600 * 1000;
}

function isValidSession(value: unknown): value is PersistedSession {
  if (!value || typeof value !== "object") return false;
  const s = value as Record<string, unknown>;
  return (
    typeof s.accessToken === "string" &&
    typeof s.refreshToken === "string" &&
    typeof s.previewId === "string" &&
    typeof s.role === "string" &&
    typeof s.displayName === "string" &&
    typeof s.expiresAt === "number"
  );
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

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/** In-memory fallback used when sessionStorage is unavailable (privacy mode / node). */
function memoryStorage(): SessionStorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
}

const sharedMemoryStorage = memoryStorage();

function defaultStorage(): SessionStorageLike {
  try {
    if (typeof sessionStorage !== "undefined") return sessionStorage;
  } catch {
    // Access can throw under strict privacy settings.
  }
  return sharedMemoryStorage;
}
