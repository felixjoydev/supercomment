/**
 * Embedded review-session — network steps (supabase-js-FREE raw fetch).
 *
 * The overlay must not pull in @supabase/supabase-js, so anon sign-in, review-token
 * exchange, and refresh are raw `fetch` calls behind an injectable `fetchImpl`
 * seam. Part of the auth/session barrel (see ../session.ts).
 *
 * VERIFY IN REAL ENV: the live Supabase anon sign-in + refresh endpoints and the
 * cross-origin exchange POST (CORS) cannot be exercised in this sandbox; they are
 * isolated behind the `fetchImpl` seam.
 */

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
  /** Phase 2: member session's send-to-agent grant (guests always false). */
  canSendToAgent: boolean;
}

type FetchLike = typeof fetch;

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
    canSendToAgent: data.canSendToAgent === true,
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

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}
