import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireMember, type VerifiedClaims } from '@/lib/auth-guard';
import {
  computeLinkPatch,
  LinkActionError,
  type LinkAction,
  type PreviewLinkState,
} from '@/lib/link';

const KNOWN_ACTIONS = new Set<LinkAction['type']>([
  'rename',
  'set_access_mode',
  'regenerate',
  'revoke',
  'set_expiry',
]);

/**
 * Link-management endpoint for a single preview.
 *
 * Authz enforced HERE: verify the user (getClaims), confirm preview team
 * membership (is_preview_team_member), THEN apply the computed patch via an
 * RLS-scoped UPDATE. Destructive semantics (regenerate rotates the secret;
 * revoke nulls it + drops to team_only) live in the pure lib/link module; the
 * confirmation UX lives client-side. Effects are immediate: rotating/clearing
 * link_secret means the old guest link stops matching on the very next request.
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const supabase = await createClient();

  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = (claimsData?.claims ?? null) as VerifiedClaims | null;

  const { data: isMember } = await supabase.rpc('is_preview_team_member', {
    p_preview_id: id,
  });
  const guard = requireMember(claims, isMember === true);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (
    !body ||
    typeof body !== 'object' ||
    typeof (body as { type?: unknown }).type !== 'string' ||
    !KNOWN_ACTIONS.has((body as { type: LinkAction['type'] }).type)
  ) {
    return NextResponse.json({ error: 'Invalid or unknown action' }, { status: 400 });
  }
  const action = body as LinkAction;

  // Read current link state (RLS-scoped — also re-confirms visibility).
  const { data: current, error: readErr } = await supabase
    .from('previews')
    .select('name, access_mode, link_secret, expires_at')
    .eq('id', id)
    .maybeSingle();
  if (readErr) {
    return NextResponse.json({ error: readErr.message }, { status: 400 });
  }
  if (!current) {
    return NextResponse.json({ error: 'Preview not found' }, { status: 404 });
  }

  let patch;
  try {
    patch = computeLinkPatch(action, current as PreviewLinkState);
  } catch (err) {
    if (err instanceof LinkActionError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  const { data, error } = await supabase
    .from('previews')
    .update(patch)
    .eq('id', id)
    .select('id, project_id, name, slug, access_mode, link_secret, expires_at, status')
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ preview: data }, { status: 200 });
}
