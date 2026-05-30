import { redirect } from 'next/navigation';
import { getVerifiedClaims } from '@/lib/server-auth';

/**
 * Root: send signed-in members to the dashboard, everyone else to login.
 */
export default async function HomePage() {
  const claims = await getVerifiedClaims();
  if (claims && claims.is_anonymous !== true) {
    redirect('/dashboard');
  }
  redirect('/login');
}
