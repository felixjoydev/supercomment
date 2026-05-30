-- =============================================================================
-- SuperComment — U2 RLS (membership helpers + policies)
-- =============================================================================
-- Security-definer helpers wrapped with (select auth.uid()) for the Supabase
-- RLS performance pattern. They run as the table owner (the migration role),
-- so reading team_members inside a team_members policy does NOT recurse.
--
-- Policy model:
--   * Every tenant table has RLS enabled.
--   * Policies are scoped TO authenticated and use (select auth.uid()).
--   * Team members get read/write on their own team's rows; preview-scoped
--     tables join previews -> projects -> team_members.
--   * Anonymous / guest users carry the `authenticated` role but are never
--     team_members, so they fail every base-table policy. Their only write
--     path is the security-definer RPCs (0003). The raw `anon` role is not in
--     TO authenticated and is denied outright.
--   * comments / participants have NO direct INSERT policy: numbering and
--     trust tagging happen exclusively inside the RPCs.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Is the current user a member of the given team?
create or replace function public.is_team_member(p_team_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.team_members tm
    where tm.team_id = p_team_id
      and tm.user_id = (select auth.uid())
  );
$$;

-- Is the current user a member of the team that owns the given project?
create or replace function public.is_project_team_member(p_project_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.projects pr
    join public.team_members tm on tm.team_id = pr.team_id
    where pr.id = p_project_id
      and tm.user_id = (select auth.uid())
  );
$$;

-- Is the current user a member of the team that owns the given preview?
create or replace function public.is_preview_team_member(p_preview_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.previews pv
    join public.projects pr on pr.id = pv.project_id
    join public.team_members tm on tm.team_id = pr.team_id
    where pv.id = p_preview_id
      and tm.user_id = (select auth.uid())
  );
$$;

-- Is the current user a participant (member or guest) on the given preview?
create or replace function public.is_preview_participant(p_preview_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.participants pa
    where pa.preview_id = p_preview_id
      and pa.user_id = (select auth.uid())
  );
$$;

-- Is the current user an anonymous (guest) user? Reads the JWT claim.
create or replace function public.is_anon_user()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((((select auth.jwt()) ->> 'is_anonymous'))::boolean, false);
$$;

-- Policies invoke these helpers as the connection role, so it needs EXECUTE.
revoke execute on function public.is_team_member(uuid) from public;
revoke execute on function public.is_project_team_member(uuid) from public;
revoke execute on function public.is_preview_team_member(uuid) from public;
revoke execute on function public.is_preview_participant(uuid) from public;
revoke execute on function public.is_anon_user() from public;

grant execute on function public.is_team_member(uuid) to anon, authenticated;
grant execute on function public.is_project_team_member(uuid) to anon, authenticated;
grant execute on function public.is_preview_team_member(uuid) to anon, authenticated;
grant execute on function public.is_preview_participant(uuid) to anon, authenticated;
grant execute on function public.is_anon_user() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Enable RLS
-- ---------------------------------------------------------------------------
alter table public.teams         enable row level security;
alter table public.team_members  enable row level security;
alter table public.projects      enable row level security;
alter table public.previews      enable row level security;
alter table public.participants  enable row level security;
alter table public.comments      enable row level security;
alter table public.snapshots     enable row level security;

-- ---------------------------------------------------------------------------
-- teams
--   Creating a team is allowed for any non-anonymous user; the creator's first
--   team_members row is bootstrapped server-side (service role / U8 flow).
-- ---------------------------------------------------------------------------
create policy teams_select on public.teams
  for select to authenticated
  using (public.is_team_member(id));

create policy teams_insert on public.teams
  for insert to authenticated
  with check (not public.is_anon_user());

create policy teams_update on public.teams
  for update to authenticated
  using (public.is_team_member(id))
  with check (public.is_team_member(id));

create policy teams_delete on public.teams
  for delete to authenticated
  using (public.is_team_member(id));

-- ---------------------------------------------------------------------------
-- team_members
--   A user can always see their own membership rows; existing members can see
--   and manage the rest. First-member bootstrap is via the service role.
-- ---------------------------------------------------------------------------
create policy team_members_select on public.team_members
  for select to authenticated
  using ((select auth.uid()) = user_id or public.is_team_member(team_id));

create policy team_members_insert on public.team_members
  for insert to authenticated
  with check (public.is_team_member(team_id));

create policy team_members_update on public.team_members
  for update to authenticated
  using (public.is_team_member(team_id))
  with check (public.is_team_member(team_id));

create policy team_members_delete on public.team_members
  for delete to authenticated
  using (public.is_team_member(team_id));

-- ---------------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------------
create policy projects_select on public.projects
  for select to authenticated
  using (public.is_team_member(team_id));

create policy projects_insert on public.projects
  for insert to authenticated
  with check (public.is_team_member(team_id));

create policy projects_update on public.projects
  for update to authenticated
  using (public.is_team_member(team_id))
  with check (public.is_team_member(team_id));

create policy projects_delete on public.projects
  for delete to authenticated
  using (public.is_team_member(team_id));

-- ---------------------------------------------------------------------------
-- previews
-- ---------------------------------------------------------------------------
create policy previews_select on public.previews
  for select to authenticated
  using (public.is_preview_team_member(id));

create policy previews_insert on public.previews
  for insert to authenticated
  with check (public.is_project_team_member(project_id));

create policy previews_update on public.previews
  for update to authenticated
  using (public.is_preview_team_member(id))
  with check (public.is_preview_team_member(id));

create policy previews_delete on public.previews
  for delete to authenticated
  using (public.is_preview_team_member(id));

-- ---------------------------------------------------------------------------
-- participants — members read; writes only through the RPCs.
-- ---------------------------------------------------------------------------
create policy participants_select on public.participants
  for select to authenticated
  using (public.is_preview_team_member(preview_id));

-- ---------------------------------------------------------------------------
-- comments — members read / update (status) / delete their team's comments.
--   No INSERT policy: inserts (with atomic numbering) happen only via the
--   security-definer write RPCs.
-- ---------------------------------------------------------------------------
create policy comments_select on public.comments
  for select to authenticated
  using (public.is_preview_team_member(preview_id));

create policy comments_update on public.comments
  for update to authenticated
  using (public.is_preview_team_member(preview_id))
  with check (public.is_preview_team_member(preview_id));

create policy comments_delete on public.comments
  for delete to authenticated
  using (public.is_preview_team_member(preview_id));

-- ---------------------------------------------------------------------------
-- snapshots — members manage snapshots for their team's previews. (Guest
-- snapshot upload, when added in U10, goes through a dedicated RPC.)
-- ---------------------------------------------------------------------------
create policy snapshots_select on public.snapshots
  for select to authenticated
  using (public.is_preview_team_member(preview_id));

create policy snapshots_insert on public.snapshots
  for insert to authenticated
  with check (public.is_preview_team_member(preview_id));

create policy snapshots_update on public.snapshots
  for update to authenticated
  using (public.is_preview_team_member(preview_id))
  with check (public.is_preview_team_member(preview_id));

create policy snapshots_delete on public.snapshots
  for delete to authenticated
  using (public.is_preview_team_member(preview_id));
