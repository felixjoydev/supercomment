-- =============================================================================
-- 0054_list_review_comments_lane.sql — expose lane to the overlay read (U10)
-- =============================================================================
-- The overlay loads a preview's comments through list_review_comments (with the
-- reviewer's anon SESSION JWT). To render lane-aware pins, member lane controls,
-- reviewer "Ready for review" state, and the agent's "what changed" summary, the
-- RPC must return the comment's `lane` and `review_summary`. Adding columns to a
-- `returns table (...)` changes the return type, so this DROPs + CREATEs (same
-- name/args). Additive for the deployed overlay: an older bundle simply ignores
-- the new columns until it is redeployed (the same forward-compat pattern 0050
-- relied on). is_sent stays lane-aware (0053), unchanged here.
--
-- REAL-ENV GATE (rolled-back txn): a member session gets lane + review_summary
-- on each row; a guest session still authorizes and reads (labels are an overlay
-- concern, not the RPC's). get_advisors(security) clean.
-- =============================================================================

drop function if exists public.list_review_comments(uuid);

create or replace function public.list_review_comments(p_preview_id uuid)
returns table (
  id                uuid,
  number            integer,
  intent            text,
  severity          text,
  note              text,
  status            text,
  is_stale          boolean,
  context           jsonb,
  created_at        timestamptz,
  display_name      text,
  path              text,
  status_changed_at timestamptz,
  latest_reply_at   timestamptz,
  last_read_at      timestamptz,
  is_own            boolean,
  is_sent           boolean,
  lane              text,
  review_summary    text
)
language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := (select auth.uid());
  v_session public.review_sessions%rowtype;
  v_member  uuid;
  v_email   text;
  v_caller  uuid;
begin
  if v_uid is null then raise exception 'no_review_session' using errcode = '42501'; end if;

  select * into v_session from public.review_sessions rs
    where rs.anon_user_id = v_uid and rs.preview_id = p_preview_id;
  if not found or v_session.expires_at < now() then
    raise exception 'no_review_session' using errcode = '42501';
  end if;

  v_caller := coalesce(v_session.member_user_id, v_uid);
  if v_session.role = 'member' then
    v_member := coalesce(v_session.member_user_id, v_uid);
  else
    select pt.email_ci into v_email from public.participants pt
      where pt.preview_id = p_preview_id and pt.user_id = v_uid limit 1;
  end if;

  return query
  select
    c.id, c.number, c.intent, c.severity, c.note, c.status, c.is_stale, c.context,
    c.created_at, pt.display_name, c.path, c.status_changed_at,
    rr.latest_reply_at,
    crs.last_read_at,
    (pt.user_id = v_caller) as is_own,
    (c.lane <> 'backlog'
      or exists (select 1 from public.comment_queue q where q.comment_id = c.id)) as is_sent,
    c.lane,
    c.review_summary
  from public.comments c
  join public.participants pt on pt.id = c.author_participant
  left join lateral (
    select max(r.created_at) as latest_reply_at
    from public.comment_replies r where r.comment_id = c.id
  ) rr on true
  left join public.comment_read_state crs
    on crs.comment_id = c.id
    and (crs.member_user_id = v_member or crs.guest_email_ci = v_email)
  where c.preview_id = p_preview_id
  order by c.number;
end;
$$;

revoke all on function public.list_review_comments(uuid) from public, anon;
grant execute on function public.list_review_comments(uuid) to authenticated;
