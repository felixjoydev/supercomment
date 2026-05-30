'use server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

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

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${origin}/auth/callback` },
  });
  if (error) return { error: error.message };
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
