-- 0009_fix_regrant_rls_helpers.sql
-- Corrects 0008. Revoking EXECUTE from the `authenticated` role on the internal
-- RLS helper functions BROKE member reads: Postgres evaluates a function used
-- inside an RLS policy AS THE CALLING ROLE. SECURITY DEFINER governs the
-- privileges the function BODY runs with, NOT whether the caller is allowed to
-- invoke the function. Every tenant table's `to authenticated` policy (and the
-- realtime.messages subscription policy) calls these helpers, so `authenticated`
-- MUST retain EXECUTE or those policies fail with "permission denied for
-- function ...".
--
-- 0008's revoke from `anon` and PUBLIC was the correct, safe part of the
-- hardening (anonymous-sign-in guests run as the `authenticated` role, not
-- `anon`; the no-JWT `anon` role never evaluates these policies, and the guest
-- write RPCs are SECURITY DEFINER so they call the helpers as the owner). That
-- part stays revoked. This migration only re-grants the role that genuinely
-- needs it.
grant execute on function public.is_team_member(uuid) to authenticated;
grant execute on function public.is_project_team_member(uuid) to authenticated;
grant execute on function public.is_preview_team_member(uuid) to authenticated;
grant execute on function public.is_preview_participant(uuid) to authenticated;
grant execute on function public.is_anon_user() to authenticated;
grant execute on function public.can_subscribe_preview(text) to authenticated;

do $$
begin
  if to_regprocedure('public.is_team_admin(uuid)') is not null then
    execute 'grant execute on function public.is_team_admin(uuid) to authenticated';
  end if;
end $$;
