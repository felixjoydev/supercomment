/**
 * Route-handler authorization guards.
 *
 * Every privileged API route repeats the same triple: verify the JWT via
 * getClaims() (never getSession), confirm workspace membership of the target
 * resource via the matching `is_*_workspace_member` SECURITY DEFINER RPC, then
 * requireMember(). These wrap that triple and return either the verified claims
 * or a ready 401/403 response, so a route body reduces to:
 *
 *   const auth = await requireMemberOfPreview(supabase, previewId);
 *   if (!auth.ok) return auth.response;
 *   // ... auth.claims is available here
 *
 * RLS remains the final backstop; this gives a proper 401/403 (and one error
 * shape) instead of a silent empty result. The pure decision lives in
 * auth-guard.ts (requireMember); this layer binds it to the request's client.
 */
import type { NextResponse } from 'next/server';
import type { createClient } from '@/lib/supabase/server';
import { requireMember, type VerifiedClaims } from '@/lib/auth-guard';
import { jsonError } from '@/lib/api-response';

/** The per-request, cookie-bound Supabase client the routes already build. */
type ServerSupabase = Awaited<ReturnType<typeof createClient>>;

export type MemberAuth =
  | { ok: true; claims: VerifiedClaims | null }
  | { ok: false; response: NextResponse };

/** Resolve verified claims (getClaims verifies the JWT; never getSession). */
async function verifiedClaims(
  supabase: ServerSupabase,
): Promise<VerifiedClaims | null> {
  const { data } = await supabase.auth.getClaims();
  return (data?.claims ?? null) as VerifiedClaims | null;
}

/** Fold resolved (claims, isMember) into the guard result / 401|403 response. */
function decide(claims: VerifiedClaims | null, isMember: boolean): MemberAuth {
  const guard = requireMember(claims, isMember);
  if (!guard.ok) {
    return { ok: false, response: jsonError(guard.error, guard.status) };
  }
  return { ok: true, claims };
}

/** Require the caller be a verified, non-anonymous member of the preview's workspace. */
export async function requireMemberOfPreview(
  supabase: ServerSupabase,
  previewId: string,
): Promise<MemberAuth> {
  const claims = await verifiedClaims(supabase);
  const { data: isMember } = await supabase.rpc('is_preview_workspace_member', {
    p_preview_id: previewId,
  });
  return decide(claims, isMember === true);
}

/** Require the caller be a verified, non-anonymous member of the project's workspace. */
export async function requireMemberOfProject(
  supabase: ServerSupabase,
  projectId: string,
): Promise<MemberAuth> {
  const claims = await verifiedClaims(supabase);
  const { data: isMember } = await supabase.rpc('is_project_workspace_member', {
    p_project_id: projectId,
  });
  return decide(claims, isMember === true);
}
