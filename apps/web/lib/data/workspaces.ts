import { createClient } from '@/lib/supabase/server';
import { DEFAULT_WORKSPACE_NAME, needsDefaultWorkspace } from '@/lib/defaults';

/**
 * Server-side workspace data access (RLS-scoped). Part of the lib/data barrel.
 */

export interface WorkspaceRow {
  id: string;
  name: string;
  created_at: string;
}

/** All workspaces the current member belongs to (RLS-scoped). */
export async function listWorkspaces(): Promise<WorkspaceRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('workspaces')
    .select('id, name, created_at')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/**
 * First-load bootstrap (U4/R4): guarantee the signed-in user has at least one
 * workspace, so a brand-new user lands straight on "create a project" instead
 * of a manual workspace step. Idempotent — only creates the default workspace
 * when the user has none. Returns the resulting workspace list.
 */
export async function ensureDefaultWorkspace(): Promise<WorkspaceRow[]> {
  const workspaces = await listWorkspaces();
  if (!needsDefaultWorkspace(workspaces.length)) return workspaces;
  const created = await createWorkspace(DEFAULT_WORKSPACE_NAME);
  return [created];
}

/**
 * First-workspace bootstrap. RLS lets a non-anon user insert a workspace but
 * blocks the first workspace_members row, so we create both atomically via the
 * create_workspace SECURITY DEFINER RPC (see migration 0005). Does NOT weaken RLS.
 */
export async function createWorkspace(name: string): Promise<WorkspaceRow> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('create_workspace', { p_name: name });
  if (error) throw error;
  return data as WorkspaceRow;
}
