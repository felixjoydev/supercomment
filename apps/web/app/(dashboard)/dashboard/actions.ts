'use server';
import { revalidatePath } from 'next/cache';
import { createTeam, createProject } from '@/lib/data';
import { getVerifiedClaims } from '@/lib/server-auth';
import { requireAuthedUser } from '@/lib/auth-guard';

/**
 * Server actions for team/project creation. Authz is re-checked here (not just
 * the proxy): we require a verified, non-anonymous user. create_team goes
 * through the SECURITY DEFINER RPC for first-team bootstrap; create_project is a
 * plain RLS-scoped insert (must already be a team member).
 */
export async function createTeamAction(formData: FormData): Promise<void> {
  const guard = requireAuthedUser(await getVerifiedClaims());
  if (!guard.ok) throw new Error(guard.error);

  const name = String(formData.get('name') ?? '').trim();
  if (!name) throw new Error('Team name is required');

  await createTeam(name);
  revalidatePath('/dashboard');
}

export async function createProjectAction(formData: FormData): Promise<void> {
  const guard = requireAuthedUser(await getVerifiedClaims());
  if (!guard.ok) throw new Error(guard.error);

  const teamId = String(formData.get('teamId') ?? '');
  const name = String(formData.get('name') ?? '').trim();
  if (!teamId) throw new Error('teamId is required');
  if (!name) throw new Error('Project name is required');

  // RLS (projects_insert) is the backstop: a non-member insert is rejected.
  await createProject(teamId, name);
  revalidatePath('/dashboard');
}
