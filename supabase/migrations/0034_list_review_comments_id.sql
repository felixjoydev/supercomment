-- 0034 — expose each comment's id from list_review_comments.
--
-- The overlay needs the comment id to reply / resolve / delete a thread (0033).
-- The id is not a secret (every thread RPC re-checks permissions server-side), so
-- adding it to the session-gated read is safe. Changing a RETURNS TABLE shape
-- requires dropping the function first.

drop function if exists public.list_review_comments(uuid);

create or replace function public.list_review_comments(
  p_preview_id uuid
)
returns table (
  id           uuid,
  number       integer,
  intent       text,
  severity     text,
  note         text,
  status       text,
  is_stale     boolean,
  context      jsonb,
  created_at   timestamptz,
  display_name text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_session public.review_sessions%rowtype;
begin
  if v_uid is null then
    raise exception 'no_review_session' using errcode = '42501';
  end if;

  select * into v_session
  from public.review_sessions rs
  where rs.anon_user_id = v_uid
    and rs.preview_id = p_preview_id;

  if not found or v_session.expires_at < now() then
    raise exception 'no_review_session' using errcode = '42501';
  end if;

  return query
  select
    c.id,
    c.number,
    c.intent,
    c.severity,
    c.note,
    c.status,
    c.is_stale,
    c.context,
    c.created_at,
    pt.display_name
  from public.comments c
  join public.participants pt on pt.id = c.author_participant
  where c.preview_id = p_preview_id
  order by c.number;
end;
$$;

revoke all on function public.list_review_comments(uuid) from public;
grant execute on function public.list_review_comments(uuid) to authenticated;
