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
 *   4. Persist { tokens, previewId, role, displayName, expiresAt, origin } in
 *      localStorage and mount. localStorage (NOT sessionStorage) is deliberate:
 *      it is shared across ALL tabs of the origin and survives full-page loads,
 *      so the toolbar re-appears with no token in the URL after same-tab
 *      navigation, in a newly-opened tab, and on reload (which also triggers
 *      redeploy-reconcile). The stored `origin` is re-checked on restore.
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
 * localStorage key for the persisted session. localStorage is per-origin AND
 * shared across every tab of that origin, so one deploy origin (= one preview in
 * this model) stores one current session that any page/tab on the same origin
 * can restore; the value carries `previewId` for server-scoped reads/writes and
 * `origin` for the restore-time domain guard.
 */
export const REVIEW_SESSION_STORAGE_KEY = "supercomment:review-session";

/** Refresh the access token when it is within this window of expiry. */
export const REFRESH_SKEW_MS = 60_000;

/** What we persist across reloads / tabs (localStorage). */
export interface PersistedSession {
  accessToken: string;
  refreshToken: string;
  previewId: string;
  role: string;
  displayName: string;
  /** Epoch milliseconds when the access token expires. */
  expiresAt: number;
  /**
   * The origin (scheme+host+port) this session was activated on. Stamped at
   * persist time and re-checked on restore as a defense-in-depth DOMAIN GUARD:
   * localStorage is already origin-partitioned by the browser, but this makes
   * the "only activate on the domain the review link was for" rule explicit.
   * Optional for backward-compat with sessions persisted before it existed.
   */
  origin?: string;
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

/** Minimal storage surface (localStorage) so persistence is testable. */
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

/**
 * Restore the persisted session, or null if absent/invalid.
 *
 * `expectedOrigin` (when provided) enforces the DOMAIN GUARD: a stored session
 * whose `origin` does not match is refused, so a stale session never activates
 * on a different origin that happens to share this browser profile. A legacy
 * session with no stored origin is allowed through. Expiry is checked by the
 * caller against `expiresAt` (see index.ts).
 */
export function restoreSession(
  storage: SessionStorageLike = defaultStorage(),
  expectedOrigin?: string,
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
    if (!isValidSession(parsed)) return null;
    if (
      expectedOrigin !== undefined &&
      parsed.origin !== undefined &&
      parsed.origin !== expectedOrigin
    ) {
      return null; // domain guard: session belongs to a different origin
    }
    return parsed;
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

/**
 * Whether a persisted session is RESTORABLE on this page load: its access token
 * is still valid, OR it carries a refresh token we can trade for a fresh one.
 * This is what lets the toolbar survive a long idle followed by navigation —
 * not just the ~1h access-token window. `activateSession` (index.ts) does the
 * actual refresh (async) and fails closed if the refresh token is also dead.
 */
export function hasRestorableSession(
  persisted: PersistedSession | null,
  now: number = Date.now(),
): boolean {
  if (!persisted) return false;
  return !isExpired(persisted.expiresAt, now) || !!persisted.refreshToken;
}

/**
 * Whether, at restore time, we should refresh BEFORE mounting: the access token
 * is expired (or within the skew window) AND a refresh token is available. When
 * false, the persisted access token is used as-is.
 */
export function shouldRefreshOnRestore(
  session: Pick<PersistedSession, "expiresAt" | "refreshToken">,
  now: number = Date.now(),
  skewMs: number = REFRESH_SKEW_MS,
): boolean {
  return isExpired(session.expiresAt, now, skewMs) && !!session.refreshToken;
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
  /**
   * Optional Cloudflare Turnstile token (U4). Included in the POST body only
   * when present, so dev (no site key → no token) keeps the body to `{ token }`.
   * The server requires it only when TURNSTILE_SECRET_KEY is configured.
   */
  turnstileToken?: string | null;
  fetchImpl?: FetchLike;
}): Promise<ExchangeResult> {
  const base = trimSlash(cfg.backendOrigin);
  const fetchImpl = cfg.fetchImpl ?? fetch;
  const payload: { token: string; turnstileToken?: string } = {
    token: cfg.token,
  };
  if (cfg.turnstileToken) {
    payload.turnstileToken = cfg.turnstileToken;
  }
  const res = await fetchImpl(`${base}/api/review-token/exchange`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${cfg.accessToken}`,
    },
    body: JSON.stringify(payload),
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
// Turnstile (U4) — invisible token acquisition, supabase-js-free + seam-injected.
//
// When a site key is configured (boot config `turnstileSiteKey`), load the
// Turnstile script + render an INVISIBLE widget and resolve a token to send to
// the exchange. When NO site key is configured (dev), resolve null immediately
// (the server skips verification when TURNSTILE_SECRET_KEY is unset). Every DOM
// seam is injectable so the pure decision logic is unit-tested; the real
// script-load + widget render path is VERIFY IN REAL ENV.
// ---------------------------------------------------------------------------

/** The subset of the Turnstile render API we use. */
interface TurnstileRenderParams {
  sitekey: string;
  size?: string;
  callback?: (token: string) => void;
  "error-callback"?: () => void;
  "timeout-callback"?: () => void;
}

interface TurnstileApi {
  render(container: unknown, params: TurnstileRenderParams): string | undefined;
  execute?(container: unknown, params?: { sitekey?: string }): void;
}

/** Minimal window surface (injectable) so timers + the global are testable. */
interface TurnstileWindowLike {
  turnstile?: TurnstileApi;
  setTimeout(handler: () => void, ms: number): number;
  clearTimeout(id: number): void;
}

/** Minimal document surface (injectable) for the hidden widget container. */
interface TurnstileElementLike {
  style: Record<string, string>;
  remove?(): void;
}
interface TurnstileDocumentLike {
  createElement(tag: string): TurnstileElementLike;
  body: { appendChild(node: unknown): void };
}

export interface GetTurnstileTokenOptions {
  /** Cloudflare Turnstile site key from boot config; null/empty → dev (no token). */
  siteKey?: string | null;
  /** Injectable document seam (defaults to the ambient document). */
  doc?: TurnstileDocumentLike | null;
  /** Injectable window seam (defaults to the ambient window). */
  win?: TurnstileWindowLike | null;
  /** Injectable script loader (defaults to loading the Cloudflare api.js once). */
  loadScript?: () => Promise<void>;
  /** Max time to wait for a token before resolving null. */
  timeoutMs?: number;
}

/**
 * Acquire an invisible Turnstile token, or null when not configured / on any
 * failure. NEVER throws — a failure here must not break activation (the server
 * decides whether a token is required).
 */
export async function getTurnstileToken(
  opts: GetTurnstileTokenOptions,
): Promise<string | null> {
  const siteKey = opts.siteKey;
  if (!siteKey) return null; // dev / not configured → no token, no DOM work.

  const doc = opts.doc ?? defaultTurnstileDocument();
  const win = opts.win ?? defaultTurnstileWindow();
  if (!doc || !win) return null;

  const load = opts.loadScript ?? loadTurnstileScript;
  try {
    await load();
  } catch {
    return null;
  }

  const turnstile = win.turnstile;
  if (!turnstile || typeof turnstile.render !== "function") return null;

  return new Promise<string | null>((resolve) => {
    let settled = false;
    let container: TurnstileElementLike | null = null;
    const finish = (value: string | null): void => {
      if (settled) return;
      settled = true;
      win.clearTimeout(timer);
      try {
        container?.remove?.();
      } catch {
        // ignore container cleanup failures
      }
      resolve(value);
    };
    const timer = win.setTimeout(() => finish(null), opts.timeoutMs ?? 12_000);
    try {
      container = doc.createElement("div");
      container.style.display = "none";
      doc.body.appendChild(container);
      turnstile.render(container, {
        sitekey: siteKey,
        size: "invisible",
        callback: (token) => finish(token || null),
        "error-callback": () => finish(null),
        "timeout-callback": () => finish(null),
      });
      // Some invisible configurations require an explicit execute().
      if (typeof turnstile.execute === "function") {
        try {
          turnstile.execute(container, { sitekey: siteKey });
        } catch {
          // render's callback path still applies; ignore execute errors.
        }
      }
    } catch {
      finish(null);
    }
  });
}

const TURNSTILE_SCRIPT_URL =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

let turnstileScriptPromise: Promise<void> | null = null;

/**
 * Load the Turnstile script once (idempotent). Uses the ambient document — this
 * is the real-env path; tests inject `loadScript` to bypass it. VERIFY IN REAL ENV.
 */
function loadTurnstileScript(): Promise<void> {
  if (typeof document === "undefined") {
    return Promise.reject(new Error("no_document"));
  }
  if (turnstileScriptPromise) return turnstileScriptPromise;
  turnstileScriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector(
      'script[src^="https://challenges.cloudflare.com/turnstile"]',
    );
    if (existing) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = TURNSTILE_SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("turnstile_script_failed"));
    (document.head ?? document.body ?? document.documentElement).appendChild(
      script,
    );
  });
  return turnstileScriptPromise;
}

function defaultTurnstileWindow(): TurnstileWindowLike | null {
  try {
    if (typeof window !== "undefined") {
      return window as unknown as TurnstileWindowLike;
    }
  } catch {
    // ignore
  }
  return null;
}

function defaultTurnstileDocument(): TurnstileDocumentLike | null {
  try {
    if (typeof document !== "undefined") {
      return document as unknown as TurnstileDocumentLike;
    }
  } catch {
    // ignore
  }
  return null;
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
    typeof s.expiresAt === "number" &&
    (s.origin === undefined || typeof s.origin === "string")
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

/** In-memory fallback used when localStorage is unavailable (privacy mode / node). */
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

/**
 * The persistence backend: localStorage (NOT sessionStorage), so a review
 * session is shared across every tab of the origin and survives full-page
 * navigation — the toolbar re-activates itself on the next page / in a new tab
 * without the token. localStorage is per-origin, so a felixjoy.me session is
 * invisible on any other site; that origin isolation is the browser-enforced
 * half of the domain guard. Falls back to an in-memory store when localStorage
 * is unavailable (privacy mode / node).
 */
function defaultStorage(): SessionStorageLike {
  try {
    if (typeof localStorage !== "undefined") return localStorage;
  } catch {
    // Access can throw under strict privacy settings.
  }
  return sharedMemoryStorage;
}
