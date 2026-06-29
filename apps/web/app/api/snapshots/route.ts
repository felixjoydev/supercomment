import { NextResponse } from 'next/server';
import {
  guestSnapshotRequestSchema,
  memberSnapshotRequestSchema,
} from '@supercomment/shared';
import { createClient } from '../../../lib/supabase/server';

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
 *  - Members POST authenticated; we verify the session, check workspace membership
 *    via is_preview_workspace_member, then insert under RLS as the member.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
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
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return NextResponse.json({ snapshot: data }, { status: 201 });
  }

  // Member path: must be authenticated and a workspace member of the preview.
  const memberParse = memberSnapshotRequestSchema.safeParse(body);
  if (!memberParse.success) {
    return NextResponse.json({ error: 'invalid request' }, { status: 400 });
  }

  const { previewId, path, payload } = memberParse.data;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Explicit membership check via the security-definer helper, then insert
  // (RLS on snapshots also enforces this, defense in depth).
  const { data: isMember, error: memberError } = await supabase.rpc(
    'is_preview_workspace_member',
    { p_preview_id: previewId },
  );
  if (memberError) {
    return NextResponse.json({ error: memberError.message }, { status: 403 });
  }
  if (!isMember) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

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
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
  return NextResponse.json({ snapshot: data }, { status: 201 });
}
