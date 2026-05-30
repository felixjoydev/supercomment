import type { ReactNode } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getVerifiedClaims, getVerifiedUser } from '@/lib/server-auth';
import { signOut } from '@/app/login/actions';

/**
 * Auth-gated dashboard shell. This layout re-verifies the user with
 * getClaims()/getUser() on every render — it does NOT trust the proxy. An
 * unauthenticated or anonymous visitor is redirected to /login. (Defense in
 * depth: proxy + layout + per-route guards + RLS.)
 */
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const claims = await getVerifiedClaims();
  if (!claims || claims.is_anonymous === true) {
    redirect('/login');
  }
  const user = await getVerifiedUser();

  return (
    <div>
      <header className="dash-top">
        <Link href="/dashboard" className="dash-brand">
          SuperComment
        </Link>
        <div className="dash-top-right">
          {user?.email ? <span className="dash-user">{user.email}</span> : null}
          <form action={signOut}>
            <button type="submit" className="dash-signout">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="dash-main">{children}</main>
    </div>
  );
}
