import { createClient } from '@/lib/supabase/server';

/**
 * Server-side workspace-member data access + send-to-agent permission (Phase 2),
 * RLS-scoped. Part of the lib/data barrel.
 */

/** One workspace member for the members-management UI (Phase 2). */
export interface WorkspaceMemberRow {
  userId: string;
  email: string | null;
  role: string;
  isSelf: boolean;
  /** Whether this member may send comments/templates to the coding agent. */
  canSendToAgent: boolean;
}

export interface WorkspaceMembers {
  members: WorkspaceMemberRow[];
  /** True when the CURRENT user owns this workspace (may flip the toggle). */
  viewerIsOwner: boolean;
}

/**
 * List a workspace's members + their send-to-agent permission (Phase 2). Member
 * identities (email/role/is_self) come from the list_workspace_members
 * SECURITY DEFINER RPC (it joins auth.users, which RLS won't expose directly);
 * the can_send_to_agent flag is read straight from workspace_members, which RLS
 * lets any member of the workspace see. Merged by user_id.
 */
export async function listWorkspaceMembers(
  workspaceId: string,
): Promise<WorkspaceMembers> {
  const supabase = await createClient();

  const { data: identities, error: idError } = await supabase.rpc(
    'list_workspace_members',
    { p_team_id: workspaceId },
  );
  if (idError) throw idError;

  const { data: flags, error: flagError } = await supabase
    .from('workspace_members')
    .select('user_id, can_send_to_agent')
    .eq('workspace_id', workspaceId);
  if (flagError) throw flagError;

  const canByUser = new Map<string, boolean>();
  for (const row of (flags ?? []) as { user_id: string; can_send_to_agent: boolean }[]) {
    canByUser.set(row.user_id, row.can_send_to_agent === true);
  }

  const members: WorkspaceMemberRow[] = (
    (identities ?? []) as {
      user_id: string;
      email: string | null;
      role: string;
      is_self: boolean;
    }[]
  ).map((m) => ({
    userId: m.user_id,
    email: m.email ?? null,
    role: m.role,
    isSelf: m.is_self === true,
    canSendToAgent: canByUser.get(m.user_id) ?? false,
  }));

  const viewerIsOwner = members.some((m) => m.isSelf && m.role === 'owner');
  return { members, viewerIsOwner };
}

/**
 * Flip a member's send-to-agent permission (Phase 2). The set_member_send_to_agent
 * RPC is owner-gated + only ever touches the flag, so this cannot be used to
 * escalate anything else even though the caller is a plain RLS-scoped member.
 */
export async function setMemberSendToAgent(
  workspaceId: string,
  memberUserId: string,
  value: boolean,
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc('set_member_send_to_agent', {
    p_workspace_id: workspaceId,
    p_member_user_id: memberUserId,
    p_can: value,
  });
  if (error) throw error;
}

/**
 * Whether the CURRENT user may send this preview's comments to the coding agent
 * (Phase 2). Drives the dashboard button's VISIBILITY; the /api/send-to-claude
 * route independently re-enforces it (the real guard). Fails closed to false.
 */
export async function canCurrentUserSendToAgent(previewId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('can_user_send_to_agent', {
    p_preview_id: previewId,
  });
  if (error) return false;
  return data === true;
}
