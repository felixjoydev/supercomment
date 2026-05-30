import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

/**
 * Per-request, cookie-bound Supabase client for Server Components, Route
 * Handlers, and Server Actions.
 *
 * Created fresh per request (never shared across requests) and wired to the
 * Next.js cookie store so the auth session is read from / written to cookies.
 *
 * IMPORTANT: validate the user with getClaims()/getUser() (which verify the
 * token), NOT getSession() (which trusts unverified cookie contents). Authz is
 * enforced both here (RLS as the authed member) and explicitly in the route
 * handlers / actions / layout — never relying on the proxy alone.
 */
export async function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY (see .env.example)',
    );
  }

  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // `setAll` was called from a Server Component, where mutating cookies
          // is not allowed. This is safe to ignore when the session is being
          // refreshed by the proxy (which CAN write cookies) on every request.
        }
      },
    },
  });
}
