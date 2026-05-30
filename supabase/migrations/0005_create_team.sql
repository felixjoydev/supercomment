-- =============================================================================
-- SuperComment — U8 first-team bootstrap RPC
-- =============================================================================
-- RLS lets a non-anonymous user INSERT a teams row (teams_insert: not
-- is_anon_user()), but team_members_insert requires is_team_member(team_id),
-- which a brand-new user can never satisfy for their FIRST membership (no row
-- exists yet). Rather than weaken team_members RLS, we create the team and the
-- owner membership atomically in one SECURITY DEFINER function. This keeps the
-- "members manage their team" policy model intact (U2) while making
-- self-service onboarding possible (R4/R21).
--
-- Definer-safe: search_path = '', fully schema-qualified, rejects anonymous and
-- unauthenticated callers, and grants EXECUTE only to authenticated.
--
-- The previews.last_heartbeat_at column the dashboard reads for live/offline
-- status already exists in 0001_schema.sql; U8 only READS it (writes come from
-- the U4/U5 CLI), so no schema change is needed here.
-- =============================================================================
create or replace function public.create_team(p_name text)
returns public.teams
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_team public.teams%rowtype;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  -- Anonymous (guest) sessions must never create teams (R24 security default).
  if public.is_anon_user() then
    raise exception 'anonymous_not_allowed' using errcode = '42501';
  end if;

  if coalesce(nullif(btrim(p_name), ''), '') = '' then
    raise exception 'team_name_required' using errcode = 'P0001';
  end if;

  insert into public.teams (name)
  values (btrim(p_name))
  returning * into v_team;

  insert into public.team_members (team_id, user_id, role)
  values (v_team.id, v_uid, 'owner');

  return v_team;
end;
$$;

revoke execute on function public.create_team(text) from public;
grant execute on function public.create_team(text) to authenticated;
