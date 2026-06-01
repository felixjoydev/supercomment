import type { NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

/**
 * Next 16 "proxy" (the renamed, Node-runtime-by-default replacement for
 * middleware.ts). Runs on every matched request to refresh the Supabase auth
 * cookie and redirect unauthenticated users to /login.
 *
 * This is a UX/session-refresh layer only — NOT the security boundary. Auth is
 * independently enforced in the (dashboard) layout, every route handler, and
 * every server action, with RLS as the final backstop. (Research: do not rely
 * on the proxy alone for authz.)
 */
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Run on everything except Next internals, static assets, AND the public
  // shared-preview routes (/s/<slug>): those must be reachable by guests with
  // no account, so the session-refresh/redirect layer must not touch them.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|s/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
