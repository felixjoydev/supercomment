import { createClient } from '@/lib/supabase/server';
import {
  buildDefaultReviewLinkInsert,
  insertPreviewWithSlugRetry,
} from '@/lib/defaults';

/**
 * Server-side project data access (RLS-scoped). Part of the lib/data barrel.
 */

export interface ProjectRow {
  id: string;
  workspace_id: string;
  name: string;
  created_at: string;
}

/** Projects for a workspace (RLS scopes to the member's workspaces). */
export async function listProjects(workspaceId: string): Promise<ProjectRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('projects')
    .select('id, workspace_id, name, created_at')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/**
 * Projects for MANY workspaces in ONE query (RLS-scoped), grouped by workspace
 * id (WEB-9). Replaces N per-workspace listProjects() calls on the dashboard.
 * RLS still filters to the member's own workspaces, and `created_at asc` is
 * preserved within each group, so each group equals what listProjects() returned.
 */
export async function listProjectsForWorkspaces(
  workspaceIds: string[],
): Promise<Map<string, ProjectRow[]>> {
  const byWorkspace = new Map<string, ProjectRow[]>();
  if (workspaceIds.length === 0) return byWorkspace;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('projects')
    .select('id, workspace_id, name, created_at')
    .in('workspace_id', workspaceIds)
    .order('created_at', { ascending: true });
  if (error) throw error;

  for (const row of (data ?? []) as ProjectRow[]) {
    const list = byWorkspace.get(row.workspace_id) ?? [];
    list.push(row);
    byWorkspace.set(row.workspace_id, list);
  }
  return byWorkspace;
}

/** A single project (or null if not visible to the member). */
export async function getProject(projectId: string): Promise<ProjectRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('projects')
    .select('id, workspace_id, name, created_at')
    .eq('id', projectId)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

/**
 * Create a project under a workspace (RLS: must be a workspace member) and
 * immediately give it one default review link (U4/R5), so a new project is
 * shareable with no manual "Add review link" step. Both inserts go through the
 * same RLS-scoped client (member-only). Returns the project row.
 */
export async function createProject(workspaceId: string, name: string): Promise<ProjectRow> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('projects')
    .insert({ workspace_id: workspaceId, name })
    .select('id, workspace_id, name, created_at')
    .single();
  if (error) throw error;
  const project = data as ProjectRow;

  await createDefaultReviewLink(supabase, project.id);
  return project;
}

/**
 * Insert the single default review link (`previews` row) for a freshly-created
 * project. access_mode stays the DB literal 'team_only' (shown as "Members
 * only"); the slug is a generated, non-secret /s/<slug> segment. Retries once
 * on the astronomically unlikely slug collision, mirroring the previews route.
 */
async function createDefaultReviewLink(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string,
): Promise<void> {
  const result = await insertPreviewWithSlugRetry(async (slug) => {
    const { error } = await supabase
      .from('previews')
      .insert(buildDefaultReviewLinkInsert(projectId, slug));
    return error;
  });
  if (result.ok) return;
  if (result.error) throw result.error;
  throw new Error('Could not allocate a unique slug for the default review link');
}
