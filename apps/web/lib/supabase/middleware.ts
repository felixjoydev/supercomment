import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

/**
 * Shared session-refresh logic used by the Next 16 proxy (proxy.ts).
 *
 * Responsibilities:
 *   1. Refresh the Supabase auth cookie on every matched request (so an
 *      expiring access token is rotated transparently).
 *   2. Redirect unauthenticated users away from app pages to /login.
 *
 * Auth is validated with getClaims() (verifies the JWT) — NOT getSession().
 *
 * NOTE: this is a convenience/UX layer, NOT the security boundary. Research is
 * emphatic that the proxy can be bypassed in some deployments, so every route
 * handler, server action, and the (dashboard) layout independently re-checks
 * the user. RLS is the final backstop on all data access.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    // Without config we can't refresh; let the request through so the route's
    // own env check produces a clear error rather than a confusing redirect.
    return supabaseResponse;
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        supabaseResponse = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          supabaseResponse.cookies.set(name, value, options);
        }
      },
    },
  });

  // Refresh + verify. Do not run code between createServerClient and getClaims.
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims ?? null;

  const { pathname } = request.nextUrl;
  const isPublic =
    pathname.startsWith('/login') ||
    pathname.startsWith('/auth') ||
    // Shared preview links are public by design: guests with the link (and no
    // account) must reach them. Access control for /s/ is the slug + link
    // secret + access_mode, NOT a dashboard login.
    pathname.startsWith('/s/') ||
    // Embedded-mode public surfaces, reached cross-origin by customer apps with
    // NO SuperComment session: the overlay loader + its static bundle, and the
    // token-exchange API (bearer-authed via the anon JWT, not the dashboard
    // cookie). These must never redirect to /login.
    pathname.startsWith('/sc-loader') ||
    pathname.startsWith('/sc/') ||
    pathname.startsWith('/api/review-token') ||
    pathname === '/';

  if (!claims && !isPublic) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = '/login';
    redirectUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(redirectUrl);
  }

  return supabaseResponse;
}
