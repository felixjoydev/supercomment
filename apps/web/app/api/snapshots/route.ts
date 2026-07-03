import { NextResponse } from 'next/server';
import {
  guestSnapshotRequestSchema,
  memberSnapshotRequestSchema,
} from '@supercomment/shared';
import { createClient } from '@/lib/supabase/server';
import { requireMemberOfPreview } from '@/lib/api-auth';
import { jsonError } from '@/lib/api-response';

/**
 * POST /api/snapshots
 *
 * Ingest a page snapshot captured by the overlay (U10). Two write paths,
 * mirroring the comment ingest design:
 *  - Guests POST with a `linkSecret`; we call the create_guest_snapshot RPC
 *    (SECURITY DEFINER, 0007) which re-validates the secret server-side and
 *    inserts past RLS for exactly the preview the secret unlocks. The anon /
 *    authenticated grant on the function is what makes this safe — guests never
 *    touch the snapshots table directly.
 *  - Members POST authenticated; requireMemberOfPreview verifies the session and
 *    workspace membership (getClaims + is_preview_workspace_member), then we
 *    insert under RLS as the member.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid JSON', 400);
  }

  const supabase = await createClient();

  // Guest path: presence of linkSecret selects the security-definer RPC.
  const guestParse = guestSnapshotRequestSchema.safeParse(body);
  if (guestParse.success) {
    const { linkSecret, path, payload } = guestParse.data;
    const { data, error } = await supabase.rpc('create_guest_snapshot', {
      p_link_secret: linkSecret,
      p_path: path,
      p_payload: payload,
    });
    if (error) {
      // Generic message — never surface the raw Postgres error (L3).
      return jsonError('Snapshot rejected', 403);
    }
    return NextResponse.json({ snapshot: data }, { status: 201 });
  }

  // Member path: must be authenticated and a workspace member of the preview.
  const memberParse = memberSnapshotRequestSchema.safeParse(body);
  if (!memberParse.success) {
    return jsonError('Invalid request', 400);
  }

  const { previewId, path, payload } = memberParse.data;

  const auth = await requireMemberOfPreview(supabase, previewId);
  if (!auth.ok) return auth.response;

  // Insert as the member (RLS on snapshots also enforces membership — defense in
  // depth).
  const { data, error } = await supabase
    .from('snapshots')
    .insert({
      preview_id: previewId,
      path,
      payload,
    })
    .select()
    .single();
  if (error) {
    return jsonError('Snapshot rejected', 403);
  }
  return NextResponse.json({ snapshot: data }, { status: 201 });
}
