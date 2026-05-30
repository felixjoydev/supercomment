-- 0008_tighten_grants.sql
-- U13 security hardening: tighten grants on internal SECURITY DEFINER helpers
-- and re-pin a trigger function's search_path.
--
-- Background (Supabase advisors):
--   * anon_security_definer_function_executable — the RLS helper functions are
--     SECURITY DEFINER and were left EXECUTE-able by anon/authenticated over the
--     REST surface. They are only ever meant to be called INSIDE RLS policies
--     and from other SECURITY DEFINER RPCs (which run as the function owner, not
--     the caller). Revoking direct REST execute from anon/authenticated does NOT
--     break those internal call sites; it just removes a needless public entry
--     point. We REVOKE here.
--   * function_search_path_mutable — re-create the queue trigger function with a
--     pinned empty search_path (idempotent; safe even if already pinned).
--
-- We deliberately do NOT touch the write-path RPCs:
--   * create_guest_comment / create_guest_snapshot  -> anon needs these.
--   * create_member_comment / resolve_comment /
--     dismiss_comment / create_team                 -> authenticated needs these.

-- ---------------------------------------------------------------------------
-- Revoke direct execute on the always-present internal RLS helpers.
-- ---------------------------------------------------------------------------
revoke execute on function public.is_team_member(uuid) from anon, authenticated;
revoke execute on function public.is_project_team_member(uuid) from anon, authenticated;
revoke execute on function public.is_preview_team_member(uuid) from anon, authenticated;
revoke execute on function public.is_preview_participant(uuid) from anon, authenticated;
revoke execute on function public.is_anon_user() from anon, authenticated;
revoke execute on function public.can_subscribe_preview(text) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Guard-wrapped revokes for helpers that MAY be present depending on which
-- migrations a given environment has applied. to_regprocedure(...) returns NULL
-- when the function does not exist, so we only revoke when it resolves.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.is_team_admin(uuid)') is not null then
    execute 'revoke execute on function public.is_team_admin(uuid) from anon, authenticated';
  end if;
end $$;

do $$
begin
  if to_regprocedure('public.allocate_comment_number(uuid)') is not null then
    execute 'revoke execute on function public.allocate_comment_number(uuid) from anon, authenticated';
  end if;
end $$;

do $$
begin
  if to_regprocedure('public.broadcast_comment_change()') is not null then
    execute 'revoke execute on function public.broadcast_comment_change() from anon, authenticated';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Re-pin the queue updated_at trigger function's search_path (advisor:
-- function_search_path_mutable). Re-creating with the pin is idempotent and
-- safe; the trigger that references it is unaffected.
-- ---------------------------------------------------------------------------
create or replace function public.touch_comment_queue_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
