/**
 * Keeps the MCP server's Supabase access token fresh.
 *
 * The binding stores a short-lived (~1h) Supabase access token plus a long-lived
 * refresh token (written by `supercomment login`). The MCP server is long-lived
 * — a coding session easily outlasts the access token — so before every request
 * it asks this source for a CURRENTLY-valid access token. When the stored one is
 * within a margin of expiry it transparently exchanges the refresh token for a
 * new pair (Supabase rotates the refresh token on every use) and persists the
 * rotation back to the binding so the next process starts fresh too.
 *
 * No `@supabase/supabase-js` dependency: the refresh is a plain POST to the
 * GoTrue token endpoint, so this whole unit is testable without the SDK and
 * independent of supabase-js internals/versions.
 */
import { decodeJwtExp } from "../auth/identity.js";

/** The token material the source manages. */
export interface TokenSet {
  accessToken: string;
  /** Absent for env/manual bindings that carry no refresh token. */
  refreshToken?: string;
  /** Unix seconds the access token expires; undefined = unknown (decode it). */
  expiresAt?: number;
}

/** Exchanges a refresh token for a fresh token pair. Injectable for tests. */
export type RefreshFn = (
  supabaseUrl: string,
  anonKey: string,
  refreshToken: string,
) => Promise<{ accessToken: string; refreshToken: string; expiresAt?: number }>;

/** Persist a rotated token pair (e.g. back into the binding file). */
export type PersistTokens = (tokens: {
  accessToken: string;
  refreshToken: string;
}) => Promise<void>;

/** Strip a trailing slash so the token endpoint URL is well-formed. */
function trimSlash(s: string): string {
  return s.replace(/\/+$/, "");
}

/**
 * The default refresh: POST grant_type=refresh_token to GoTrue. apikey = anon
 * key (gateway requirement); the body carries the refresh token. The caller has
 * already host-pinned `supabaseUrl` (assertAllowedSupabaseUrl), so the refresh
 * token only ever goes to the validated project host.
 */
export const defaultRefreshFn: RefreshFn = async (
  supabaseUrl,
  anonKey,
  refreshToken,
) => {
  const res = await fetch(
    `${trimSlash(supabaseUrl)}/auth/v1/token?grant_type=refresh_token`,
    {
      method: "POST",
      headers: { apikey: anonKey, "content-type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    },
  );
  if (!res.ok) {
    throw new Error(
      `Supabase token refresh failed (HTTP ${res.status}). Your session may ` +
        "have expired — re-run `supercomment login`.",
    );
  }
  const j = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_at?: number;
  };
  if (!j.access_token || !j.refresh_token) {
    throw new Error(
      "Supabase token refresh returned no tokens; re-run `supercomment login`.",
    );
  }
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token,
    ...(typeof j.expires_at === "number" ? { expiresAt: j.expires_at } : {}),
  };
};

export interface TokenSourceOptions {
  persist?: PersistTokens;
  refreshFn?: RefreshFn;
  now?: () => number;
  /** Refresh this many ms BEFORE the token actually expires. Default 60s. */
  marginMs?: number;
}

/**
 * Hands out a non-expired access token, refreshing + persisting on demand.
 * Concurrent callers during a refresh share one in-flight request (no token
 * stampede). When there is no refresh token, it simply returns the stored access
 * token unchanged (env/manual bindings degrade to the prior behavior).
 */
export class RefreshingTokenSource {
  private inflight: Promise<void> | null = null;

  constructor(
    private readonly supabaseUrl: string,
    private readonly anonKey: string,
    private tokens: TokenSet,
    private readonly opts: TokenSourceOptions = {},
  ) {}

  /** A currently-valid access token (refreshing first if near expiry). */
  async getAccessToken(): Promise<string> {
    if (!this.tokens.refreshToken || !this.needsRefresh()) {
      return this.tokens.accessToken;
    }
    if (!this.inflight) {
      this.inflight = this.refresh().finally(() => {
        this.inflight = null;
      });
    }
    await this.inflight;
    return this.tokens.accessToken;
  }

  private needsRefresh(): boolean {
    const now = (this.opts.now ?? (() => Date.now()))();
    const margin = this.opts.marginMs ?? 60_000;
    const exp = this.tokens.expiresAt;
    // Unknown expiry → refresh to be safe (only reached when we HAVE a refresh
    // token, since getAccessToken short-circuits without one).
    if (exp === undefined) return true;
    return exp * 1000 - now <= margin;
  }

  private async refresh(): Promise<void> {
    const refreshFn = this.opts.refreshFn ?? defaultRefreshFn;
    const next = await refreshFn(
      this.supabaseUrl,
      this.anonKey,
      this.tokens.refreshToken!,
    );
    this.tokens = {
      accessToken: next.accessToken,
      refreshToken: next.refreshToken,
      expiresAt: next.expiresAt ?? decodeJwtExp(next.accessToken),
    };
    if (this.opts.persist) {
      await this.opts.persist({
        accessToken: next.accessToken,
        refreshToken: next.refreshToken,
      });
    }
  }
}

/**
 * Build a `fetch` that injects a CURRENT bearer (from the source) and the anon
 * apikey on every Supabase request. Used as supabase-js's `global.fetch` so the
 * bearer stays fresh per-request without depending on the SDK's auth manager.
 */
export function makeRefreshingFetch(
  source: RefreshingTokenSource,
  anonKey: string,
  baseFetch: typeof fetch = fetch,
): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const token = await source.getAccessToken();
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${token}`);
    headers.set("apikey", anonKey);
    return baseFetch(input, { ...init, headers });
  }) as typeof fetch;
}
