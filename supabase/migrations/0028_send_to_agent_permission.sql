-- =============================================================================
-- 0028_send_to_agent_permission.sql — Send-to-agent per-member permission (Phase 2)
-- =============================================================================
-- Only workspace members explicitly granted permission may send comments /
-- templates to a coding agent (guests never — a coding agent runs on a member's
-- machine via the MCP + a linked repo, so "send to agent" is meaningless for a
-- guest). The grant is a per-member boolean flipped by the workspace OWNER in the
-- dashboard, governing BOTH ordinary comments and editor templates.
--
--   workspace_members.can_send_to_agent  boolean not null default false
--   backfill: owners → true (they own the repo/agent); everyone else stays false.
--
-- Enforcement is SERVER-SIDE (never trust the client): the enqueue path
-- (apps/web/app/api/send-to-claude/route.ts) calls can_user_send_to_agent AFTER
-- the existing is_preview_workspace_member gate and REJECTS a member without the
-- flag (and every guest). The dashboard toggle writes via the owner-gated
-- set_member_send_to_agent RPC.
--
-- House style mirrors 0016/0026: additive + idempotent DDL; SECURITY DEFINER
-- helpers with `set search_path = ''` + schema-qualified identifiers + REVOKE from
-- public + targeted GRANT to authenticated. Both new functions are READ/owner-
-- gated (not open writers): can_user_send_to_agent only reads and self-scopes to
-- auth.uid(); set_member_send_to_agent raises unless the caller owns the
-- workspace, so authenticated MUST retain execute (the internal owner check is the
-- real guard). anon is removed via `revoke ... from public`.
--
-- REAL-ENV GATE: validate this migration in a ROLLED-BACK transaction against the
-- live DB + get_advisors(security) BEFORE `supabase db push` / apply.
-- =============================================================================

-- 1. The per-member permission column ----------------------------------------
alter table public.workspace_members
  add column if not exists can_send_to_agent boolean not null default false;

-- Backfill: workspace owners can send to the agent (they own the repo/agent).
update public.workspace_members
  set can_send_to_agent = true
  where role = 'owner';

-- 2. Reader — may the CURRENT user send this preview's comments to the agent? --
-- Mirrors is_preview_workspace_member (previews → projects → workspace_members)
-- but additionally requires the caller's can_send_to_agent flag. Called by the
-- send-to-claude route as the authenticated member; self-scoped to auth.uid(), so
-- a non-member / non-permitted caller simply gets false.
create or replace function public.can_user_send_to_agent(p_preview_id uuid)
returns boolean
language sql
stable security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.previews pv
    join public.projects pr on pr.id = pv.project_id
    join public.workspace_members wm on wm.workspace_id = pr.workspace_id
    where pv.id = p_preview_id
      and wm.user_id = (select auth.uid())
      and wm.can_send_to_agent = true
  );
$function$;

-- Supabase default-grants EXECUTE to anon + authenticated on new public
-- functions, so `revoke from public` alone leaves anon able to call it; revoke
-- from public + anon + authenticated, then re-grant ONLY authenticated.
revoke all on function public.can_user_send_to_agent(uuid) from public, anon, authenticated;
grant execute on function public.can_user_send_to_agent(uuid) to authenticated;

-- 3. Writer — the owner flips a member's permission --------------------------
-- Owner-gated: raises unless the caller owns the workspace. Only ever touches
-- can_send_to_agent (never role / membership), so an owner can't escalate
-- anything else through it. Called by the dashboard members-management server
-- action as the authenticated owner.
create or replace function public.set_member_send_to_agent(
  p_workspace_id   uuid,
  p_member_user_id uuid,
  p_can            boolean
)
returns public.workspace_members
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_row public.workspace_members%rowtype;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  -- Only the workspace OWNER may change send-to-agent permissions.
  if not exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = v_uid
      and wm.role = 'owner'
  ) then
    raise exception 'not_workspace_owner' using errcode = '42501';
  end if;

  update public.workspace_members wm
  set can_send_to_agent = coalesce(p_can, false)
  where wm.workspace_id = p_workspace_id
    and wm.user_id = p_member_user_id
  returning wm.* into v_row;

  if not found then
    raise exception 'member_not_found' using errcode = 'P0001';
  end if;

  return v_row;
end;
$function$;

revoke all on function public.set_member_send_to_agent(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_member_send_to_agent(uuid, uuid, boolean) to authenticated;
