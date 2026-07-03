import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireMemberOfProject } from '@/lib/api-auth';
import { jsonError } from '@/lib/api-response';
import { insertPreviewWithSlugRetry } from '@/lib/defaults';

/**
 * Preview create endpoint.
 *
 * Authz is enforced HERE (not just in the proxy): requireMemberOfProject verifies
 * the user with getClaims() and confirms workspace membership of the parent
 * project via is_project_workspace_member before we insert. RLS (previews_insert)
 * is the final backstop. New previews default to access_mode = team_only (R24).
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid JSON', 400);
  }

  const { projectId, name } = (body ?? {}) as { projectId?: string; name?: string };
  if (!projectId || typeof projectId !== 'string') {
    return jsonError('projectId is required', 400);
  }
  const previewName = (name ?? '').trim() || 'Untitled preview';

  const auth = await requireMemberOfProject(supabase, projectId);
  if (!auth.ok) return auth.response;

  // Insert with the shared slug-collision retry. The SELECT stays a literal here;
  // the inserted row is captured for the 201 response.
  let insertedPreview: unknown = null;
  const result = await insertPreviewWithSlugRetry(async (slug) => {
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
    if (!error) insertedPreview = data;
    return error;
  });

  if (result.ok) {
    return NextResponse.json({ preview: insertedPreview }, { status: 201 });
  }
  // A non-collision error is the real failure; return a generic message, never
  // the raw Postgres error (L3). A null error means the slug was exhausted.
  if (result.error) {
    return jsonError('Could not create preview', 400);
  }
  return jsonError('Could not allocate a unique slug', 500);
}
