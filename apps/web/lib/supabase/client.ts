import { createBrowserClient } from '@supabase/ssr';

/**
 * Browser-side Supabase client for Client Components.
 *
 * Uses the public anon key (safe to ship to the browser) and the cookie-based
 * auth provided by @supabase/ssr, so the same session the server reads is
 * available client-side. All data access still goes through RLS as the
 * authenticated member, so this client can only ever see the caller's own
 * team's rows.
 *
 * URL + anon key come from env (never hardcode the project ref or any secret).
 */
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY (see .env.example)',
    );
  }
  return createBrowserClient(url, anonKey);
}
