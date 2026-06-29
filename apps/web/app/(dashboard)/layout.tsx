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
      <header className="shell-header">
        <Link href="/dashboard" className="shell-brand">
          SuperComment
        </Link>
        <div className="shell-right">
          {user?.email ? <span className="shell-user">{user.email}</span> : null}
          <form action={signOut}>
            <button type="submit" className="btn btn-quiet">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="shell-main">{children}</main>
    </div>
  );
}
