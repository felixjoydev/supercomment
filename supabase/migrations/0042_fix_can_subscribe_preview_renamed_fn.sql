-- 0042 - fix can_subscribe_preview: it called a function that no longer exists.
--
-- 0004 defined can_subscribe_preview() (the realtime.messages RLS predicate that
-- authorizes a private-channel subscription) calling public.is_preview_team_member().
-- 0024 (team -> workspace rename) DROPPED is_preview_team_member and created
-- is_preview_workspace_member, but never updated can_subscribe_preview. plpgsql
-- resolves function calls at RUN time, so the stale call did not error until
-- invoked: from then on EVERY evaluation of can_subscribe_preview threw
--   "function public.is_preview_team_member(uuid) does not exist"
-- The realtime.messages SELECT policy calls it, so the auth check errored and the
-- Realtime server denied EVERY private-channel join with
--   "Unauthorized: You do not have permissions to read from this Channel topic".
-- Effect: realtime broadcast delivery was silently dead for BOTH the dashboard and
-- the overlay since 0024 (the overlay's live updates were actually its background
-- poll). 0040 recreated the function but copied the same stale call, so it stayed
-- broken. Point it at the renamed helper. The OR still short-circuits, so an
-- earlier-throwing branch cannot mask the others.

create or replace function public.can_subscribe_preview(p_topic text)
returns boolean
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_preview_id uuid;
begin
  if p_topic is null or p_topic !~ '^preview:' then
    return false;
  end if;

  begin
    v_preview_id := substring(p_topic from 9)::uuid;  -- skip 'preview:'
  exception when others then
    return false;
  end;

  return public.is_preview_workspace_member(v_preview_id)
      or public.is_preview_participant(v_preview_id)
      or public.has_active_review_session(v_preview_id::text);
end;
$$;

revoke execute on function public.can_subscribe_preview(text) from public;
grant execute on function public.can_subscribe_preview(text) to anon, authenticated;
