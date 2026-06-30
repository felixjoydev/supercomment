import { redirect } from 'next/navigation';
import { getVerifiedClaims, getVerifiedUser } from '@/lib/server-auth';
import { parseCallbackPort } from '@/lib/cli-auth';
import { AuthorizeCli } from './authorize-cli';

/**
 * CLI authorization page. `supercomment login` opens this with `?port=&state=`,
 * the signed-in developer clicks "Authorize CLI", and the client component POSTs
 * the session token back to the loopback callback server the CLI is running.
 *
 * Auth-gated like the dashboard: an unauthenticated or anonymous visitor is
 * bounced through /login and returned here (port + state preserved) — we never
 * hand a token to a guest session. The token never touches the server here; it
 * is read client-side and sent straight to 127.0.0.1.
 */
export default async function CliAuthPage({
  searchParams,
}: {
  searchParams: Promise<{ port?: string; state?: string }>;
}) {
  const { port: portRaw, state } = await searchParams;

  const claims = await getVerifiedClaims();
  if (!claims || claims.is_anonymous === true) {
    const params = new URLSearchParams();
    if (portRaw) params.set('port', portRaw);
    if (state) params.set('state', state);
    redirect(`/login?next=${encodeURIComponent(`/cli-auth?${params.toString()}`)}`);
  }

  const port = parseCallbackPort(portRaw);
  const user = await getVerifiedUser();

  return (
    <main className="auth-screen">
      <AuthorizeCli port={port} state={state ?? ''} email={user?.email ?? null} />
    </main>
  );
}
