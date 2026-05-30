import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireMember, type VerifiedClaims } from '@/lib/auth-guard';
import { generateSlug } from '@/lib/slug';

/**
 * Preview create endpoint.
 *
 * Authz is enforced HERE (not just in the proxy): we verify the user with
 * getClaims() and confirm team membership of the parent project via the
 * is_project_team_member helper before inserting. RLS (previews_insert) is the
 * final backstop. New previews default to access_mode = team_only (R24).
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();

  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = (claimsData?.claims ?? null) as VerifiedClaims | null;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { projectId, name } = (body ?? {}) as { projectId?: string; name?: string };
  if (!projectId || typeof projectId !== 'string') {
    return NextResponse.json({ error: 'projectId is required' }, { status: 400 });
  }
  const previewName = (name ?? '').trim() || 'Untitled preview';

  // Membership check on the parent project.
  const { data: isMember } = await supabase.rpc('is_project_team_member', {
    p_project_id: projectId,
  });
  const guard = requireMember(claims, isMember === true);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  // Retry once on the (astronomically unlikely) slug collision.
  for (let attempt = 0; attempt < 2; attempt++) {
    const slug = generateSlug();
    const { data, error } = await supabase
      .from('previews')
      .insert({
        project_id: projectId,
        name: previewName,
        slug,
        access_mode: 'team_only',
        status: 'offline',
      })
      .select('id, project_id, name, slug, access_mode, status')
      .single();

    if (!error) {
      return NextResponse.json({ preview: data }, { status: 201 });
    }
    // 23505 = unique_violation (slug). Anything else is a real failure.
    if (error.code !== '23505') {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
  }

  return NextResponse.json({ error: 'Could not allocate a unique slug' }, { status: 500 });
}
