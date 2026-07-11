/**
 * Shared structural types for the CLI's Supabase clients.
 *
 * Each CLI module declares its own minimal `from()`/`rpc()` client slice — the
 * real `@supabase/supabase-js` client satisfies all of them structurally, and a
 * test fake need only satisfy the slice a given module uses. Those slices
 * legitimately differ (different query chains: select→eq→order vs
 * select→eq→eq→maybeSingle vs rpc-only), so they stay next to their use.
 *
 * What every slice shares is the PostgREST result envelope. It lives here so it
 * is defined exactly once instead of re-inlined at each call site.
 */

/** A PostgREST result envelope for a single row / scalar / void result. */
export interface DbResult {
  data: unknown;
  error: unknown;
}

/** A PostgREST result envelope for a list query (`select(...).order(...)`). */
export interface DbListResult {
  data: unknown[] | null;
  error: unknown;
}

/**
 * The Storage API's `createSignedUrl` result envelope (U7). Mirrors the real
 * `@supabase/supabase-js` `storage.from(bucket).createSignedUrl(path, expiresIn)`
 * response shape exactly (see `apps/web`'s `capture-image.tsx`, the existing
 * dashboard signer): `data` and `error` are mutually exclusive.
 */
export interface DbSignedUrlResult {
  data: { signedUrl: string } | null;
  error: unknown;
}
