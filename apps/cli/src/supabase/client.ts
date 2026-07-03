/**
 * The CLI's member-scoped Supabase client factory.
 *
 * Two distinct credentials ride every request, and conflating them is the
 * classic failure (R25):
 *   - `apikey`        = the project ANON key (a valid publishable API key). The
 *                       PostgREST gateway authenticates the REQUEST with this;
 *                       a user JWT here is rejected with "Invalid API key". It is
 *                       supplied as the positional key argument to `createClient`,
 *                       which is exactly how supabase-js populates the `apikey`
 *                       header.
 *   - `Authorization` = `Bearer <member JWT>`. This overrides supabase-js's
 *                       default `Bearer <anonKey>` so RLS reads the developer's
 *                       member identity (not the anon/guest path) and scopes
 *                       every visible row to their own workspaces.
 *
 * Realtime/auth persistence are disabled: the short-lived `login`/`init`/`link`
 * commands only do request/response reads + RPC calls, never a browser session.
 * `@supabase/supabase-js` is imported dynamically so unit tests that inject their
 * own client never load the SDK.
 *
 * NOTE: the long-running MCP server (`createSupabaseStore`) deliberately does NOT
 * use this helper — it injects a *refreshing* bearer per-request via a custom
 * fetch so the token stays fresh across a long session. This factory is for the
 * one-shot CLI commands that hold a single static token.
 */
export async function makeMemberClient<T = unknown>(
  supabaseUrl: string,
  anonKey: string,
  token: string,
): Promise<T> {
  const mod = await import("@supabase/supabase-js");
  const client = mod.createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  return client as unknown as T;
}
