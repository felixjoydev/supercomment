'use server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { safeNextPath } from '@/lib/safe-redirect';

/**
 * Server actions for auth. We use a passwordless magic link (OTP) as the
 * primary flow and expose an OAuth helper. The actual session is established
 * when the user returns to /auth/callback (which exchanges the code for cookies
 * via the per-request server client).
 *
 * VERIFY IN REAL ENV: the full magic-link / OAuth round trip (email delivery,
 * provider redirect, cookie set) requires a live Supabase project + configured
 * redirect URLs and cannot be exercised in this sandbox.
 */

function originFromHeaders(host: string | null, proto: string | null): string {
  const h = host ?? 'localhost:3000';
  const p = proto ?? (h.startsWith('localhost') ? 'http' : 'https');
  return `${p}://${h}`;
}

export async function signInWithEmail(
  _prev: { error?: string; sent?: boolean } | undefined,
  formData: FormData,
): Promise<{ error?: string; sent?: boolean }> {
  const email = String(formData.get('email') ?? '').trim();
  if (!email) return { error: 'Email is required' };

  const supabase = await createClient();
  const hdrs = await headers();
  const origin = originFromHeaders(hdrs.get('host'), hdrs.get('x-forwarded-proto'));
  // Carry a safe `next` through the magic-link round trip so team_only review
  // links return the reviewer to /s/<slug> after sign-in (U2 / AE4).
  const next = safeNextPath(String(formData.get('next') ?? ''));

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });
  if (error) return { error: error.message };
  return { sent: true };
}

/**
 * Dev-friendly email + password auth. Avoids the magic-link email path entirely
 * (Supabase's built-in mailer is rate-limited and unreliable), so local dev and
 * demos sign in instantly. Sign-up succeeds immediately when "Confirm email" is
 * OFF in the Supabase dashboard; if it's ON, the user must confirm first.
 */
export async function signInWithPassword(
  _prev: { error?: string; sent?: boolean } | undefined,
  formData: FormData,
): Promise<{ error?: string; sent?: boolean }> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  if (!email || !password) return { error: 'Email and password are required' };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };
  redirect(safeNextPath(String(formData.get('next') ?? '')));
}

export async function signUpWithPassword(
  _prev: { error?: string; sent?: boolean } | undefined,
  formData: FormData,
): Promise<{ error?: string; sent?: boolean }> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  if (!email || !password) return { error: 'Email and password are required' };
  if (password.length < 6) return { error: 'Password must be at least 6 characters' };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) return { error: error.message };
  // When "Confirm email" is OFF, a session is returned and we're signed in.
  if (data.session) redirect(safeNextPath(String(formData.get('next') ?? '')));
  // Otherwise the account exists but needs email confirmation.
  return { sent: true };
}

export async function signInWithGitHub(): Promise<void> {
  const supabase = await createClient();
  const hdrs = await headers();
  const origin = originFromHeaders(hdrs.get('host'), hdrs.get('x-forwarded-proto'));

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'github',
    options: { redirectTo: `${origin}/auth/callback` },
  });
  if (error) throw error;
  if (data?.url) redirect(data.url);
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}
