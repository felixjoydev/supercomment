import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireMemberOfPreview } from '@/lib/api-auth';
import { jsonError } from '@/lib/api-response';
import {
  computeLinkPatch,
  LinkActionError,
  parseLinkAction,
  type LinkAction,
  type PreviewLinkState,
} from '@/lib/link';

const PREVIEW_RETURN_COLS =
  'id, project_id, name, slug, access_mode, link_secret, deploy_url, expires_at, status';

/**
 * Link-management endpoint for a single preview.
 *
 * Authz enforced HERE: requireMemberOfPreview verifies the user (getClaims) and
 * confirms preview workspace membership (is_preview_workspace_member) BEFORE we
 * apply the computed patch via an RLS-scoped UPDATE. Destructive semantics
 * (regenerate rotates the secret; revoke nulls it + drops to team_only) live in
 * the pure lib/link module; the confirmation UX lives client-side. Effects are
 * immediate: rotating/clearing link_secret means the old guest link stops
 * matching on the very next request.
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const supabase = await createClient();

  const auth = await requireMemberOfPreview(supabase, id);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid JSON', 400);
  }

  let action: LinkAction;
  try {
    action = parseLinkAction(body);
  } catch (err) {
    if (err instanceof LinkActionError) {
      return jsonError(err.message, 400);
    }
    throw err;
  }

  // Read current link state (RLS-scoped — also re-confirms visibility).
  const { data: current, error: readErr } = await supabase
    .from('previews')
    .select('name, access_mode, link_secret, expires_at')
    .eq('id', id)
    .maybeSingle();
  if (readErr) {
    return jsonError('Could not load preview', 400);
  }
  if (!current) {
    return jsonError('Preview not found', 404);
  }

  let patch;
  try {
    patch = computeLinkPatch(action, current as PreviewLinkState);
  } catch (err) {
    if (err instanceof LinkActionError) {
      return jsonError(err.message, 400);
    }
    throw err;
  }

  // deploy_url is a redirect target /s later trusts, so it is written through the
  // allowlist-enforcing SECURITY DEFINER RPC (register_deploy_target) rather than
  // a direct UPDATE. computeLinkPatch already validated it via isAllowedDeployUrl
  // for a fast 400; the RPC re-validates server-side (defense in depth) and is the
  // single authoritative writer, mirroring register_preview_tunnel.
  if (action.type === 'set_deploy_url') {
    const { error: rpcErr } = await supabase.rpc('register_deploy_target', {
      p_preview_id: id,
      p_deploy_url: patch.deploy_url as string,
    });
    if (rpcErr) {
      return jsonError('Could not update deploy URL', 400);
    }
    const { data, error } = await supabase
      .from('previews')
      .select(PREVIEW_RETURN_COLS)
      .eq('id', id)
      .single();
    if (error) {
      return jsonError('Could not update preview', 400);
    }
    return NextResponse.json({ preview: data }, { status: 200 });
  }

  const { data, error } = await supabase
    .from('previews')
    .update(patch)
    .eq('id', id)
    .select(PREVIEW_RETURN_COLS)
    .single();
  if (error) {
    return jsonError('Could not update preview', 400);
  }

  return NextResponse.json({ preview: data }, { status: 200 });
}
