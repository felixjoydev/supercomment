import { createClient } from '@/lib/supabase/server';
import type { AccessMode } from '@/lib/link';
import type { PreviewDbStatus } from '@/lib/status';

/**
 * Server-side preview (review-link) data access (RLS-scoped). Part of the
 * lib/data barrel.
 */

export interface PreviewRow {
  id: string;
  project_id: string;
  name: string;
  slug: string;
  access_mode: AccessMode;
  link_secret: string | null;
  /** Stable deployed-preview origin the embedded /s link redirects to (U7/U13). */
  deploy_url: string | null;
  expires_at: string | null;
  status: PreviewDbStatus;
  last_heartbeat_at: string | null;
  created_at: string;
}

const PREVIEW_COLS =
  'id, project_id, name, slug, access_mode, link_secret, deploy_url, expires_at, status, last_heartbeat_at, created_at';

/** Previews for a project (RLS-scoped). */
export async function listPreviews(projectId: string): Promise<PreviewRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('previews')
    .select(PREVIEW_COLS)
    .eq('project_id', projectId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as PreviewRow[];
}

/** A single preview (or null if not visible to the member). */
export async function getPreview(previewId: string): Promise<PreviewRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('previews')
    .select(PREVIEW_COLS)
    .eq('id', previewId)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as PreviewRow | null;
}
