import { createClient } from '@/lib/supabase/server';
import type { AccessMode } from '@/lib/link';
import type { PreviewDbStatus } from '@/lib/status';

/**
 * Server-side data access for the dashboard. Every read/write goes through the
 * per-request RLS-scoped client, so the authenticated member only ever sees
 * their own team's rows — multi-tenant isolation is enforced by the U2 policies,
 * not by these functions. They just shape the queries.
 */

export interface TeamRow {
  id: string;
  name: string;
  created_at: string;
}

export interface ProjectRow {
  id: string;
  team_id: string;
  name: string;
  created_at: string;
}

export interface PreviewRow {
  id: string;
  project_id: string;
  name: string;
  slug: string;
  access_mode: AccessMode;
  link_secret: string | null;
  expires_at: string | null;
  status: PreviewDbStatus;
  last_heartbeat_at: string | null;
  created_at: string;
}

/** All teams the current member belongs to (RLS-scoped). */
export async function listTeams(): Promise<TeamRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('teams')
    .select('id, name, created_at')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/** Projects for a team (RLS scopes to the member's teams). */
export async function listProjects(teamId: string): Promise<ProjectRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('projects')
    .select('id, team_id, name, created_at')
    .eq('team_id', teamId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/** A single project (or null if not visible to the member). */
export async function getProject(projectId: string): Promise<ProjectRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('projects')
    .select('id, team_id, name, created_at')
    .eq('id', projectId)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

const PREVIEW_COLS =
  'id, project_id, name, slug, access_mode, link_secret, expires_at, status, last_heartbeat_at, created_at';

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

/**
 * First-team bootstrap. RLS lets a non-anon user insert a team but blocks the
 * first team_members row, so we create both atomically via the create_team
 * SECURITY DEFINER RPC (see migration 0005). Does NOT weaken RLS.
 */
export async function createTeam(name: string): Promise<TeamRow> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('create_team', { p_name: name });
  if (error) throw error;
  return data as TeamRow;
}

/** Create a project under a team (RLS: must be a team member). */
export async function createProject(teamId: string, name: string): Promise<ProjectRow> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('projects')
    .insert({ team_id: teamId, name })
    .select('id, team_id, name, created_at')
    .single();
  if (error) throw error;
  return data as ProjectRow;
}
