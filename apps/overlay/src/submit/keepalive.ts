/**
 * keepalive_review_session caller (0039 / sliding session lifetime).
 *
 * Extends the reviewer's session while they are active, and revives a lapsed one
 * from the Renew button, gated server-side on the review link still being valid.
 * Returns the new expiry (ms since epoch) on success, or null when the session has
 * lapsed and cannot be revived (link revoked/expired, or the auth session is gone).
 * Never throws.
 */
export interface KeepAliveConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  previewId: string;
  getAccessToken: () => string | Promise<string>;
  fetchImpl?: typeof fetch;
}

export function makeKeepAlive(
  config: KeepAliveConfig,
): () => Promise<number | null> {
  if (!config.supabaseUrl || !config.supabaseAnonKey || !config.previewId) {
    throw new Error("makeKeepAlive requires a supabaseUrl, anon key, and previewId.");
  }
  const base = config.supabaseUrl.replace(/\/+$/, "");
  const doFetch = config.fetchImpl ?? fetch;
  return async (): Promise<number | null> => {
    try {
      const accessToken = await config.getAccessToken();
      const res = await doFetch(`${base}/rest/v1/rpc/keepalive_review_session`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          apikey: config.supabaseAnonKey,
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ p_preview_id: config.previewId }),
      });
      if (!res.ok) return null; // no_review_session / access_revoked
      const data = (await res.json()) as unknown; // a timestamptz string
      const ms = typeof data === "string" ? Date.parse(data) : NaN;
      return Number.isNaN(ms) ? null : ms;
    } catch {
      return null;
    }
  };
}
