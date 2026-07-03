/**
 * Embedded review-session — persistence + expiry (supabase-js-free, pure).
 *
 * Persists the activated session in localStorage (per-origin, shared across every
 * tab, survives full-page loads) so the toolbar re-appears after navigation with
 * no token in the URL, and computes the restore/refresh decisions. Falls back to
 * an in-memory store when localStorage is unavailable. Part of the auth/session
 * barrel (see ../session.ts).
 */

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
  /**
   * Phase 2: whether this MEMBER session may send comments/templates to the
   * coding agent (guests are always false). Drives the overlay editor footer's
   * conditional "Send to agent" button. Optional for backward-compat with
   * sessions persisted before it existed (treated as false).
   */
  canSendToAgent?: boolean;
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
  /**
   * EMBEDDED backend coordinates, cached from the boot config at activation so a
   * RESTORE on a later page load / new tab is SELF-CONTAINED: the overlay can
   * re-mount from localStorage even when that page did not re-inject the boot
   * config, as long as the overlay bundle loaded there. All PUBLIC values (the
   * anon key + URLs already ship in the page). Optional for backward-compat.
   */
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  backendOrigin?: string;
}

/** Minimal storage surface (localStorage) so persistence is testable. */
export interface SessionStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

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
    (s.origin === undefined || typeof s.origin === "string") &&
    (s.supabaseUrl === undefined || typeof s.supabaseUrl === "string") &&
    (s.supabaseAnonKey === undefined || typeof s.supabaseAnonKey === "string") &&
    (s.backendOrigin === undefined || typeof s.backendOrigin === "string")
  );
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
