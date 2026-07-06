-- 0040 - let an active review session subscribe to its preview's realtime topic.
--
-- 0004's can_subscribe_preview authorized realtime.messages SELECT (i.e. receiving
-- the preview:<id> broadcast) for only two principals:
--   - a workspace member (is_preview_team_member), and
--   - a preview participant (is_preview_participant).
-- Neither covers the OVERLAY's review session on its own JWT:
--   - a guest becomes a participant only AFTER posting their first comment, and
--   - a member reviewing via the overlay is a participant under their REAL account,
--     not the anonymous session uid the overlay's JWT carries.
-- So the overlay could READ a preview's comments (list_review_comments authorizes
-- via has_active_review_session) but could NOT subscribe to its broadcast, which is
-- why live pins / replies / deletes never reached the overlay.
--
-- Align the subscribe gate with the read model: a caller with an ACTIVE review
-- session for the preview may also subscribe. This is additive and exposes nothing
-- new — such a caller can already read every comment/reply the topic would deliver
-- (same has_active_review_session predicate guards list_review_comments + captures).

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

  return public.is_preview_team_member(v_preview_id)
      or public.is_preview_participant(v_preview_id)
      or public.has_active_review_session(v_preview_id::text);
end;
$$;

revoke execute on function public.can_subscribe_preview(text) from public;
grant execute on function public.can_subscribe_preview(text) to anon, authenticated;
