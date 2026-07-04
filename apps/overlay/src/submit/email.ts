/**
 * set_guest_email caller (0036 / U11).
 *
 * Persists the guest's (unverified) email server-side so per-viewer read-state and
 * "pages I commented on" key to it, and the author-read seed can find it. Uses the
 * reviewer's preview-scoped session JWT, exactly like the comment submitter.
 *
 * Best-effort by design: it resolves false on any failure and NEVER throws, so a
 * hiccup here can never block the comment submit. The email still persists locally
 * (GuestEmailStore) and a member can set it from the dashboard as a fallback.
 *
 * VERIFY IN REAL ENV: the live PostgREST RPC POST (auth header, the session guard,
 * CORS from the customer origin) cannot run in this sandbox; only arg building is
 * covered by tests.
 */
export interface SetGuestEmailConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  /** The preview this session is scoped to (server re-checks via the JWT). */
  previewId: string;
  getAccessToken: () => string | Promise<string>;
  /** Override `fetch` (tests). */
  fetchImpl?: typeof fetch;
}

/** Named arguments set_guest_email expects (mirrors 0036). */
export interface SetGuestEmailArgs {
  p_preview_id: string;
  p_email: string;
}

export function makeSetGuestEmail(
  config: SetGuestEmailConfig,
): (email: string) => Promise<boolean> {
  if (!config.supabaseUrl || !config.supabaseAnonKey || !config.previewId) {
    throw new Error("makeSetGuestEmail requires a supabaseUrl, anon key, and previewId.");
  }
  const base = config.supabaseUrl.replace(/\/+$/, "");
  const doFetch = config.fetchImpl ?? fetch;
  return async (email: string): Promise<boolean> => {
    const args: SetGuestEmailArgs = {
      p_preview_id: config.previewId,
      p_email: email,
    };
    try {
      const accessToken = await config.getAccessToken();
      const res = await doFetch(`${base}/rest/v1/rpc/set_guest_email`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          apikey: config.supabaseAnonKey,
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(args),
      });
      return res.ok;
    } catch {
      return false;
    }
  };
}
