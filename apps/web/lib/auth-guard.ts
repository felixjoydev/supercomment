/**
 * Pure authorization guards for route handlers / server actions.
 *
 * Research is emphatic: do not rely on the proxy for authz. Every privileged
 * entry point calls these to (a) confirm there is a verified, non-anonymous
 * user, and (b) confirm that user is a member of the relevant workspace/preview
 * BEFORE acting. RLS is still the final backstop, but a clear guard gives a
 * proper 401/403 instead of a silent empty result.
 *
 * The guards take *already-resolved* facts (claims, membership boolean) so they
 * are dependency-free and unit-testable with mocked Supabase clients.
 */

export type GuardResult =
  | { ok: true }
  | { ok: false; status: 401 | 403; error: string };

/** Minimal shape of the verified JWT claims we care about. */
export interface VerifiedClaims {
  sub?: string;
  /** Supabase sets this for anonymous sign-ins. */
  is_anonymous?: boolean;
  [key: string]: unknown;
}

/**
 * Require a verified, non-anonymous member.
 *   - no claims                  → 401 (not signed in)
 *   - anonymous (guest) session  → 403 (guests can't use the dashboard)
 *   - not a member of the resource → 403
 */
export function requireMember(
  claims: VerifiedClaims | null | undefined,
  isMember: boolean,
): GuardResult {
  if (!claims || !claims.sub) {
    return { ok: false, status: 401, error: 'Not authenticated' };
  }
  if (claims.is_anonymous === true) {
    return { ok: false, status: 403, error: 'Guests cannot manage previews' };
  }
  if (!isMember) {
    return { ok: false, status: 403, error: 'Not a member of this workspace' };
  }
  return { ok: true };
}

/**
 * Require only a verified, non-anonymous user (no resource scope yet) — e.g.
 * for "create my first workspace" or "list my workspaces".
 */
export function requireAuthedUser(claims: VerifiedClaims | null | undefined): GuardResult {
  if (!claims || !claims.sub) {
    return { ok: false, status: 401, error: 'Not authenticated' };
  }
  if (claims.is_anonymous === true) {
    return { ok: false, status: 403, error: 'Guests cannot use the dashboard' };
  }
  return { ok: true };
}
