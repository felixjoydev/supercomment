import { createClient } from '@/lib/supabase/server';
import type { AccessMode } from '@/lib/link';
import type { PreviewDbStatus } from '@/lib/status';
import { toCommentView } from '@/lib/comments/transform';
import type { CommentView, CommentRow, SendStatus } from '@/lib/comments/types';
import { generateSlug } from '@/lib/slug';
import {
  DEFAULT_WORKSPACE_NAME,
  buildDefaultReviewLinkInsert,
  needsDefaultWorkspace,
} from '@/lib/defaults';

/**
 * Server-side data access for the dashboard. Every read/write goes through the
 * per-request RLS-scoped client, so the authenticated member only ever sees
 * their own workspace's rows — multi-tenant isolation is enforced by the U2 policies,
 * not by these functions. They just shape the queries.
 */

export interface WorkspaceRow {
  id: string;
  name: string;
  created_at: string;
}

export interface ProjectRow {
  id: string;
  workspace_id: string;
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
  /** Stable deployed-preview origin the embedded /s link redirects to (U7/U13). */
  deploy_url: string | null;
  expires_at: string | null;
  status: PreviewDbStatus;
  last_heartbeat_at: string | null;
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

/**
 * Initial RLS-scoped comment list for a preview's review dashboard. The browser
 * client then keeps it live via the private broadcast channel (U9 realtime).
 * Joins the authoring participant for a display name. Returns the full set
 * (open + history); the client picks the default view via selectDefaultView.
 */
export async function getCommentsForPreview(previewId: string): Promise<CommentView[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('comments')
    .select(
      'id, preview_id, number, author_participant, trust_level, intent, severity, note, status, fidelity, kind, is_stale, context, path, resolved_summary, created_at, participants:author_participant(display_name)',
    )
    .eq('preview_id', previewId)
    .order('created_at', { ascending: false });

  if (error) throw error;

  // Hydrate each comment's latest "Send to Claude" status from comment_queue so
  // the dashboard button reflects the real persisted state on load (Queued /
  // Working / Done) instead of resetting to "Send to Claude" after a refresh.
  // RLS scopes this to the member's previews, same as the comments read above.
  const sendStatusByComment = await getSendStatusMap(supabase, previewId);

  return (data ?? []).map((row) => {
    const raw = row as Record<string, unknown>;
    const participant = Array.isArray(raw.participants)
      ? (raw.participants as { display_name?: string | null }[])[0]
      : (raw.participants as { display_name?: string | null } | null);
    const authorName = participant?.display_name ?? null;
    const view = toCommentView(row as unknown as CommentRow, authorName);
    return { ...view, sendStatus: sendStatusByComment.get(view.id) ?? null };
  });
}

/**
 * Map each comment id → its most recent comment_queue status for a preview. A
 * comment can have multiple rows over time (re-sends after a terminal state);
 * the newest row wins, so a fresh "pending" supersedes an older "done".
 */
async function getSendStatusMap(
  supabase: Awaited<ReturnType<typeof createClient>>,
  previewId: string,
): Promise<Map<string, SendStatus>> {
  const map = new Map<string, SendStatus>();
  const { data, error } = await supabase
    .from('comment_queue')
    .select('comment_id, status, created_at')
    .eq('preview_id', previewId)
    .order('created_at', { ascending: true });
  if (error) return map; // queue is non-critical; degrade to "never sent"
  for (const row of (data ?? []) as { comment_id: string; status: SendStatus }[]) {
    map.set(row.comment_id, row.status); // ascending order → last write wins
  }
  return map;
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
  for (let attempt = 0; attempt < 2; attempt++) {
    const { error } = await supabase
      .from('previews')
      .insert(buildDefaultReviewLinkInsert(projectId, generateSlug()));
    if (!error) return;
    // 23505 = unique_violation (slug). Anything else is a real failure.
    if (error.code !== '23505') throw error;
  }
  throw new Error('Could not allocate a unique slug for the default review link');
}
