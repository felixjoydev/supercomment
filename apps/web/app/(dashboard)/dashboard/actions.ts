'use server';
import { revalidatePath } from 'next/cache';
import { createWorkspace, createProject } from '@/lib/data';
import { getVerifiedClaims } from '@/lib/server-auth';
import { requireAuthedUser } from '@/lib/auth-guard';

/**
 * Server actions for workspace/project creation. Authz is re-checked here (not
 * just the proxy): we require a verified, non-anonymous user. create_workspace
 * goes through the SECURITY DEFINER RPC for first-workspace bootstrap;
 * create_project is a plain RLS-scoped insert (must already be a workspace member).
 */
export async function createWorkspaceAction(formData: FormData): Promise<void> {
  const guard = requireAuthedUser(await getVerifiedClaims());
  if (!guard.ok) throw new Error(guard.error);

  const name = String(formData.get('name') ?? '').trim();
  if (!name) throw new Error('Workspace name is required');

  await createWorkspace(name);
  revalidatePath('/dashboard');
}

export async function createProjectAction(formData: FormData): Promise<void> {
  const guard = requireAuthedUser(await getVerifiedClaims());
  if (!guard.ok) throw new Error(guard.error);

  const workspaceId = String(formData.get('workspaceId') ?? '');
  const name = String(formData.get('name') ?? '').trim();
  if (!workspaceId) throw new Error('workspaceId is required');
  if (!name) throw new Error('Project name is required');

  // RLS (projects_insert) is the backstop: a non-member insert is rejected.
  await createProject(workspaceId, name);
  revalidatePath('/dashboard');
}
