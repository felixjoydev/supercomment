-- =============================================================================
-- 0024_rename_team_to_workspace.sql — U1: Team -> Workspace rename (in place)
-- =============================================================================
-- Renames the org concept Team -> Workspace on the live DB WITHOUT moving data:
-- in-place ALTER ... RENAME for the three tables, the three `team_id` columns,
-- and the eight name-bearing functions, then CREATE OR REPLACE of every
-- team-referencing function body so its SQL text points at the new names.
--
-- WHY THIS PRESERVES DEPENDENCIES (no policy/FK churn):
--   * RLS policies reference helper functions by OID and columns by attnum, so
--     `ALTER FUNCTION ... RENAME` (OID-preserving) and `ALTER TABLE ... RENAME
--     COLUMN` (attnum-preserving) make every policy follow automatically — no
--     policy is dropped or recreated. CREATE OR REPLACE keeps the same OID too.
--   * Table-level DML grants and FK constraints reference the relation by OID,
--     so they follow the table rename for free.
--
-- ORDER (must not change):
--   A. rename tables           (teams/team_members/team_invites -> workspace*)
--   B. rename columns          (*.team_id -> workspace_id)
--   C. rename name-bearing fns (ALTER FUNCTION ... RENAME; OID preserved)
--   D. CREATE OR REPLACE every team-referencing function under its NEW name,
--      with the body rewritten to the new table/column/helper names, and
--      re-issue grants (revoke from public + grant to the live role set).
--
-- DELIBERATELY PRESERVED (NOT renamed):
--   * The `access_mode` VALUE 'team_only' and the ('team_only','guest_link')
--     CHECK values — they are embedded-flow values, not the org concept.
--   * The `previews` table, `comments.preview_id`, `review_sessions.preview_id`
--     and the whole mint/establish/create_review_comment/list path.
--   * String LITERALS in function bodies (error messages + the 'Team member'
--     display fallback in mint_review_token) are left verbatim — the rename
--     scope is schema identifiers; UI/copy relabel is a separate unit. Only
--     identifiers (tables/columns/functions) are transformed here.
--
-- DEVIATION (forced by Postgres): the four membership helpers keep their input
-- parameter name `p_team_id` (it now carries a workspace id). Postgres
-- `CREATE OR REPLACE FUNCTION` cannot rename an input parameter (SQLSTATE
-- 42P13), and the helpers cannot be DROPped to rename it because RLS policies
-- depend on them by OID (a drop would CASCADE-drop those policies). The param
-- name is internal only; behaviour is identical.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A. Tables
-- ---------------------------------------------------------------------------
alter table public.teams        rename to workspaces;
alter table public.team_members rename to workspace_members;
alter table public.team_invites rename to workspace_invites;

-- ---------------------------------------------------------------------------
-- B. Columns (team_id -> workspace_id). After (A) the member/invite tables are
--    already public.workspace_members / public.workspace_invites.
-- ---------------------------------------------------------------------------
alter table public.projects          rename column team_id to workspace_id;
alter table public.workspace_members rename column team_id to workspace_id;
alter table public.workspace_invites rename column team_id to workspace_id;

-- ---------------------------------------------------------------------------
-- C. Rename the eight name-bearing helpers/RPCs (OID preserved -> policies
--    that reference them follow automatically).
-- ---------------------------------------------------------------------------
alter function public.is_team_member(uuid)          rename to is_workspace_member;
alter function public.is_team_owner(uuid)           rename to is_workspace_owner;
alter function public.is_team_owner_or_admin(uuid)  rename to is_workspace_owner_or_admin;
alter function public.is_project_team_member(uuid)  rename to is_project_workspace_member;
alter function public.is_preview_team_member(uuid)  rename to is_preview_workspace_member;
alter function public.list_team_members(uuid)       rename to list_workspace_members;
alter function public.create_team(text)             rename to create_workspace;
alter function public.accept_team_invite(text)      rename to accept_workspace_invite;

-- ---------------------------------------------------------------------------
-- D. Redefine every team-referencing function body under its NEW name.
--    (Bodies above are now stale text referencing the old table/column/helper
--    names; CREATE OR REPLACE rewrites them. Same OID, so policies stay bound.)
-- ---------------------------------------------------------------------------

-- --- membership helpers (LANGUAGE sql, STABLE, SECURITY DEFINER) ------------

create or replace function public.is_workspace_member(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = p_team_id
      and wm.user_id = (select auth.uid())
  );
$fn$;

create or replace function public.is_workspace_owner(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = p_team_id
      and wm.user_id = (select auth.uid())
      and wm.role = 'owner'
  );
$fn$;

create or replace function public.is_workspace_owner_or_admin(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = p_team_id
      and wm.user_id = (select auth.uid())
      and wm.role in ('owner', 'admin')
  );
$fn$;

create or replace function public.is_project_workspace_member(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
    from public.projects pr
    join public.workspace_members wm on wm.workspace_id = pr.workspace_id
    where pr.id = p_project_id
      and wm.user_id = (select auth.uid())
  );
$fn$;

create or replace function public.is_preview_workspace_member(p_preview_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
    from public.previews pv
    join public.projects pr on pr.id = pv.project_id
    join public.workspace_members wm on wm.workspace_id = pr.workspace_id
    where pv.id = p_preview_id
      and wm.user_id = (select auth.uid())
  );
$fn$;

create or replace function public.list_workspace_members(p_team_id uuid)
returns table(user_id uuid, email text, role text, joined_at timestamptz, is_self boolean)
language sql
stable
security definer
set search_path = ''
as $fn$
  select
    wm.user_id,
    u.email::text as email,
    wm.role,
    wm.created_at as joined_at,
    wm.user_id = (select auth.uid()) as is_self
  from public.workspace_members wm
  join auth.users u on u.id = wm.user_id
  where wm.workspace_id = p_team_id
    and public.is_workspace_member(p_team_id)
  order by wm.created_at asc;
$fn$;

-- --- workspace bootstrap + invite redemption (LANGUAGE plpgsql) -------------

create or replace function public.create_workspace(p_name text)
returns public.workspaces
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid       uuid := (select auth.uid());
  v_workspace public.workspaces%rowtype;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if public.is_anon_user() then
    raise exception 'anonymous users cannot create teams' using errcode = '42501';
  end if;

  if p_name is null or char_length(trim(p_name)) = 0 then
    raise exception 'team name required' using errcode = 'P0001';
  end if;

  insert into public.workspaces (name)
  values (trim(p_name))
  returning * into v_workspace;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_workspace.id, v_uid, 'owner');

  return v_workspace;
end;
$fn$;

create or replace function public.accept_workspace_invite(p_token text)
returns public.workspaces
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid       uuid := (select auth.uid());
  v_invite    public.workspace_invites%rowtype;
  v_workspace public.workspaces%rowtype;
  v_existing  uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  -- Anonymous (guest) sessions must never join a workspace (R24 security default).
  if public.is_anon_user() then
    raise exception 'anonymous_not_allowed' using errcode = '42501';
  end if;

  -- Lock the invite row so concurrent redemptions can't over-spend max_uses.
  select * into v_invite
  from public.workspace_invites
  where token = p_token
  for update;

  if not found then
    raise exception 'invalid_invite' using errcode = 'P0001';
  end if;

  if v_invite.expires_at is not null and v_invite.expires_at <= now() then
    raise exception 'invite_expired' using errcode = 'P0001';
  end if;

  -- An already-redeemed token is still usable for the SAME user (idempotent
  -- re-click), but the max_uses budget only counts distinct new members.
  select wm.id into v_existing
  from public.workspace_members wm
  where wm.workspace_id = v_invite.workspace_id
    and wm.user_id = v_uid;

  if v_existing is null and v_invite.use_count >= v_invite.max_uses then
    raise exception 'invite_used_up' using errcode = 'P0001';
  end if;

  -- Insert the membership idempotently (unique(workspace_id, user_id)). A repeat
  -- click by an existing member is a no-op and does NOT spend a use.
  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_invite.workspace_id, v_uid, v_invite.role)
  on conflict (workspace_id, user_id) do nothing;

  if found then
    -- A new membership row was created — count the redemption.
    update public.workspace_invites
    set use_count   = use_count + 1,
        accepted_at = coalesce(accepted_at, now())
    where id = v_invite.id;
  end if;

  select * into v_workspace
  from public.workspaces
  where id = v_invite.workspace_id;

  return v_workspace;
end;
$fn$;

-- --- comment write/lifecycle paths (call is_preview_workspace_member) -------

create or replace function public.create_member_comment(
  p_preview_id   uuid,
  p_path         text,
  p_display_name text,
  p_intent       text,
  p_severity     text,
  p_note         text,
  p_context      jsonb,
  p_fidelity     text default 'live'
)
returns public.comments
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid         uuid := (select auth.uid());
  v_participant uuid;
  v_number      integer;
  v_comment     public.comments%rowtype;
begin
  if v_uid is null or not public.is_preview_workspace_member(p_preview_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  insert into public.participants (preview_id, user_id, display_name, trust_level)
  values (p_preview_id, v_uid, coalesce(nullif(p_display_name, ''), 'Member'), 'member')
  on conflict (preview_id, user_id) where user_id is not null
  do update set display_name = excluded.display_name
  returning id into v_participant;

  update public.previews set comment_seq = comment_seq + 1 where id = p_preview_id returning comment_seq into v_number;

  insert into public.comments (preview_id, number, author_participant, trust_level, intent, severity, note, path, context, fidelity)
  values (p_preview_id, v_number, v_participant, 'member', p_intent, p_severity, p_note, p_path, coalesce(p_context, '{}'::jsonb), coalesce(nullif(p_fidelity, ''), 'live'))
  returning * into v_comment;
  return v_comment;
end;
$fn$;

create or replace function public.resolve_comment(p_comment_id uuid, p_summary text)
returns public.comments
language plpgsql
security definer
set search_path = ''
as $fn$
declare v_preview uuid; v_comment public.comments%rowtype;
begin
  select preview_id into v_preview from public.comments where id = p_comment_id;
  if v_preview is null then raise exception 'comment_not_found' using errcode = 'P0001'; end if;
  if not public.is_preview_workspace_member(v_preview) then raise exception 'not_authorized' using errcode = '42501'; end if;
  update public.comments set status = 'resolved', resolved_by = (select auth.uid()), resolved_summary = p_summary
   where id = p_comment_id returning * into v_comment;
  return v_comment;
end;
$fn$;

create or replace function public.dismiss_comment(p_comment_id uuid, p_reason text)
returns public.comments
language plpgsql
security definer
set search_path = ''
as $fn$
declare v_preview uuid; v_comment public.comments%rowtype;
begin
  select preview_id into v_preview from public.comments where id = p_comment_id;
  if v_preview is null then raise exception 'comment_not_found' using errcode = 'P0001'; end if;
  if not public.is_preview_workspace_member(v_preview) then raise exception 'not_authorized' using errcode = '42501'; end if;
  update public.comments set status = 'dismissed', resolved_by = (select auth.uid()), resolved_summary = p_reason
   where id = p_comment_id returning * into v_comment;
  return v_comment;
end;
$fn$;

-- --- realtime authz + queue + heartbeat + embed RPCs ------------------------

create or replace function public.can_subscribe_preview(p_topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare v_preview_id uuid;
begin
  if p_topic is null or p_topic !~ '^preview:' then return false; end if;
  begin v_preview_id := substring(p_topic from 9)::uuid; exception when others then return false; end;
  return public.is_preview_workspace_member(v_preview_id) or public.is_preview_participant(v_preview_id);
end;
$fn$;

create or replace function public.claim_next_queue_item(p_preview_id uuid)
returns setof public.comment_queue
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_id uuid;
begin
  if not public.is_preview_workspace_member(p_preview_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select id into v_id
  from public.comment_queue
  where preview_id = p_preview_id
    and status = 'pending'
  order by created_at asc
  for update skip locked
  limit 1;

  if v_id is null then
    return;
  end if;

  return query
    update public.comment_queue
    set status = 'working'
    where id = v_id
    returning *;
end;
$fn$;

create or replace function public.finish_queue_item(p_item_id uuid, p_status text, p_summary text default null::text)
returns public.comment_queue
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_preview uuid;
  v_item    public.comment_queue%rowtype;
begin
  select preview_id into v_preview
  from public.comment_queue
  where id = p_item_id;

  if v_preview is null then
    raise exception 'queue_item_not_found' using errcode = 'P0001';
  end if;

  if not public.is_preview_workspace_member(v_preview) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  if p_status not in ('done', 'failed') then
    raise exception 'invalid_finish_status' using errcode = 'P0001';
  end if;

  update public.comment_queue
  set status  = p_status,
      summary = coalesce(p_summary, summary)
  where id = p_item_id
  returning * into v_item;

  return v_item;
end;
$fn$;

create or replace function public.preview_heartbeat(p_preview_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if not public.is_preview_workspace_member(p_preview_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  update public.previews
  set status            = 'live',
      last_heartbeat_at = now()
  where id = p_preview_id;
end;
$fn$;

create or replace function public.preview_offline(p_preview_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if not public.is_preview_workspace_member(p_preview_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  update public.previews
  set status = 'offline'
  where id = p_preview_id;
end;
$fn$;

create or replace function public.register_deploy_target(p_preview_id uuid, p_deploy_url text, p_commit text default null::text)
returns table(slug text, deploy_url text)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid       uuid := (select auth.uid());
  v_url       text := btrim(coalesce(p_deploy_url, ''));
  v_lower     text := lower(v_url);
  v_authority text;
  v_host      text;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not public.is_preview_workspace_member(p_preview_id) then
    raise exception 'not authorized for this preview' using errcode = '42501';
  end if;

  if v_lower !~ '^https://' then
    raise exception 'deploy url must use https' using errcode = 'P0001';
  end if;

  v_authority := substring(v_lower from '^https://([^/?#]*)');
  if v_authority is null or v_authority = '' then
    raise exception 'deploy url has no host' using errcode = 'P0001';
  end if;
  if position('@' in v_authority) > 0 then
    raise exception 'deploy url must not contain credentials' using errcode = 'P0001';
  end if;
  if position('[' in v_authority) > 0 then
    raise exception 'deploy url host must not be an IP literal' using errcode = 'P0001';
  end if;

  v_host := split_part(v_authority, ':', 1);
  if v_host = '' then
    raise exception 'deploy url has no host' using errcode = 'P0001';
  end if;
  if v_host = 'localhost' or v_host like '%.localhost' then
    raise exception 'deploy url host must not be localhost' using errcode = 'P0001';
  end if;
  if v_host = 'local' or v_host like '%.local' then
    raise exception 'deploy url host must not be a .local (mDNS) name' using errcode = 'P0001';
  end if;
  if position('.' in v_host) = 0 then
    raise exception 'deploy url host must be a public domain' using errcode = 'P0001';
  end if;
  if v_host ~ '^[0-9.]+$' or v_host ~ '\.[0-9]+$' then
    raise exception 'deploy url host must not be an IP literal' using errcode = 'P0001';
  end if;

  return query
  update public.previews pv
     set deploy_url = v_url
   where pv.id = p_preview_id
  returning pv.slug, pv.deploy_url;
end;
$fn$;

create or replace function public.register_preview_tunnel(p_preview_id uuid, p_tunnel_url text, p_access_mode text default 'team_only'::text)
returns table(slug text)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not public.is_preview_workspace_member(p_preview_id) then
    raise exception 'not authorized for this preview' using errcode = '42501';
  end if;
  if p_tunnel_url is null
     or (p_tunnel_url !~ '^https://[a-z0-9-]+\.trycloudflare\.com(/.*)?$'
         and p_tunnel_url !~ '^https?://(localhost|127\.0\.0\.1)(:[0-9]+)?(/.*)?$') then
    raise exception 'tunnel url must be an https trycloudflare.com URL (or localhost for local testing)'
      using errcode = 'P0001';
  end if;
  if p_access_mode not in ('team_only', 'guest_link') then
    raise exception 'invalid access mode' using errcode = 'P0001';
  end if;

  return query
  update public.previews pv
     set current_tunnel_url = p_tunnel_url,
         access_mode        = p_access_mode,
         status             = 'live',
         last_heartbeat_at  = now()
   where pv.id = p_preview_id
  returning pv.slug;
end;
$fn$;

create or replace function public.mint_review_token(p_slug text, p_token text, p_link_secret text default null::text)
returns table(token text, deploy_url text, role text)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid     uuid := (select auth.uid());
  v_preview public.previews%rowtype;
  v_role    text;
  v_member  uuid;
  v_name    text;
begin
  select * into v_preview from public.previews where slug = p_slug;
  if not found then
    raise exception 'preview_not_found';
  end if;

  if v_preview.deploy_url is null then
    raise exception 'not_embeddable';
  end if;

  if public.is_preview_workspace_member(v_preview.id) then
    v_role := 'member';
    v_member := v_uid;
    select coalesce(u.email, 'Team member') into v_name
      from auth.users u where u.id = v_uid;
    if v_name is null then v_name := 'Team member'; end if;
  elsif v_preview.access_mode = 'guest_link'
        and p_link_secret is not null
        and v_preview.link_secret is not null
        and p_link_secret = v_preview.link_secret then
    if v_preview.expires_at is not null and v_preview.expires_at < now() then
      raise exception 'link_expired';
    end if;
    v_role := 'guest';
    v_member := null;
    v_name := 'Guest';
  elsif v_preview.access_mode = 'team_only' and v_uid is null then
    raise exception 'login_required';
  else
    raise exception 'access_denied';
  end if;

  insert into public.review_tokens
    (token, preview_id, role, member_user_id, display_name, expires_at)
  values
    (p_token, v_preview.id, v_role, v_member, v_name, now() + interval '90 seconds');

  return query select p_token, v_preview.deploy_url, v_role;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Re-issue grants (revoke from public + grant to the live role set per fn).
-- ---------------------------------------------------------------------------

-- helpers + workspace mgmt used inside `to authenticated` policies/dashboard.
revoke all on function public.is_workspace_member(uuid)          from public;
revoke all on function public.is_workspace_owner(uuid)           from public;
revoke all on function public.is_workspace_owner_or_admin(uuid)  from public;
revoke all on function public.is_project_workspace_member(uuid)  from public;
revoke all on function public.is_preview_workspace_member(uuid)  from public;
revoke all on function public.list_workspace_members(uuid)       from public;
revoke all on function public.accept_workspace_invite(text)      from public;
revoke all on function public.can_subscribe_preview(text)                 from public;
revoke all on function public.register_preview_tunnel(uuid, text, text)   from public;
revoke all on function public.register_deploy_target(uuid, text, text)    from public;

grant execute on function public.is_workspace_member(uuid)          to authenticated, service_role;
grant execute on function public.is_workspace_owner(uuid)           to authenticated, service_role;
grant execute on function public.is_workspace_owner_or_admin(uuid)  to authenticated, service_role;
grant execute on function public.is_project_workspace_member(uuid)  to authenticated, service_role;
grant execute on function public.is_preview_workspace_member(uuid)  to authenticated, service_role;
grant execute on function public.list_workspace_members(uuid)       to authenticated, service_role;
grant execute on function public.accept_workspace_invite(text)      to authenticated, service_role;
grant execute on function public.can_subscribe_preview(text)                to authenticated, service_role;
grant execute on function public.register_preview_tunnel(uuid, text, text)  to authenticated, service_role;
grant execute on function public.register_deploy_target(uuid, text, text)   to authenticated, service_role;

-- fns whose live grant set also includes anon.
revoke all on function public.create_workspace(text)                                                from public;
revoke all on function public.create_member_comment(uuid, text, text, text, text, text, jsonb, text) from public;
revoke all on function public.resolve_comment(uuid, text)                                            from public;
revoke all on function public.dismiss_comment(uuid, text)                                            from public;
revoke all on function public.claim_next_queue_item(uuid)                                            from public;
revoke all on function public.finish_queue_item(uuid, text, text)                                    from public;
revoke all on function public.preview_heartbeat(uuid)                                                from public;
revoke all on function public.preview_offline(uuid)                                                  from public;
revoke all on function public.mint_review_token(text, text, text)                                    from public;

grant execute on function public.create_workspace(text)                                                to anon, authenticated, service_role;
grant execute on function public.create_member_comment(uuid, text, text, text, text, text, jsonb, text) to anon, authenticated, service_role;
grant execute on function public.resolve_comment(uuid, text)                                            to anon, authenticated, service_role;
grant execute on function public.dismiss_comment(uuid, text)                                            to anon, authenticated, service_role;
grant execute on function public.claim_next_queue_item(uuid)                                            to anon, authenticated, service_role;
grant execute on function public.finish_queue_item(uuid, text, text)                                    to anon, authenticated, service_role;
grant execute on function public.preview_heartbeat(uuid)                                                to anon, authenticated, service_role;
grant execute on function public.preview_offline(uuid)                                                  to anon, authenticated, service_role;
grant execute on function public.mint_review_token(text, text, text)                                    to anon, authenticated, service_role;
