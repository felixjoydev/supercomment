'use server';
import { revalidatePath } from 'next/cache';
import { createWorkspace, createProject, setMemberSendToAgent } from '@/lib/data';
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

/**
 * Flip a workspace member's "can send to agent" permission (Phase 2). Requires a
 * verified non-anonymous user here; the set_member_send_to_agent RPC is the real
 * guard — it raises unless the CALLER owns the workspace, so a non-owner member
 * (who can technically invoke this action) is rejected at the DB.
 */
export async function setMemberSendToAgentAction(input: {
  workspaceId: string;
  memberUserId: string;
  value: boolean;
}): Promise<void> {
  const guard = requireAuthedUser(await getVerifiedClaims());
  if (!guard.ok) throw new Error(guard.error);

  if (!input.workspaceId || !input.memberUserId) {
    throw new Error('workspaceId and memberUserId are required');
  }

  await setMemberSendToAgent(input.workspaceId, input.memberUserId, input.value === true);
  revalidatePath('/dashboard');
}
