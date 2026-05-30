import { createClient } from '@/lib/supabase/server';
import type { VerifiedClaims } from '@/lib/auth-guard';

/**
 * Resolve the current verified claims server-side using getClaims() (which
 * verifies the JWT), never getSession() (which trusts unverified cookies).
 * Returns null when there is no valid session.
 */
export async function getVerifiedClaims(): Promise<VerifiedClaims | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) return null;
  return data.claims as VerifiedClaims;
}

/**
 * Resolve the current user via getUser() (verified against the auth server).
 * Used where we need the user object (email for the header) rather than raw
 * claims.
 */
export async function getVerifiedUser() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) return null;
  return data.user;
}
