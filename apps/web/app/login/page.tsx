import { redirect } from 'next/navigation';
import { getVerifiedClaims } from '@/lib/server-auth';
import { AuthForm } from './auth-form';

/**
 * Login page. If the visitor already has a verified, non-anonymous session we
 * bounce straight to the dashboard. Otherwise we render the sign-in form.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next } = await searchParams;
  const claims = await getVerifiedClaims();
  if (claims && claims.is_anonymous !== true) {
    redirect('/dashboard');
  }

  return (
    <main className="auth-screen">
      <AuthForm showAuthError={error === 'auth'} next={next} />
    </main>
  );
}
