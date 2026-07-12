-- =============================================================================
-- 0053_lane_untouched_gate.sql — "sent" now means the lane, not the queue
-- =============================================================================
-- The comment edit/delete "untouched by others" gate (0050) and the overlay's
-- is_sent flag (list_review_comments) both decided "has this been sent to the
-- agent?" by the PRESENCE of a comment_queue row. Since 0052/U5 the send action
-- is a LANE move (set_comment_lane → ready_for_agent) that writes NO
-- comment_queue row — so those gates would wrongly read a just-sent comment as
-- "never sent", re-opening the exact hole 0050 closed: an author editing a
-- comment's reference images AFTER a send, slipping an unreviewed image past the
-- agent-confirm step.
--
-- Fix: treat a comment as SENT when EITHER signal fires — the lane has left
-- backlog OR a (legacy / in-flight) comment_queue row exists. This is both:
--   * backward compatible — the still-deployed old code path
--     (send_comment_to_agent, which writes a queue row but leaves lane=backlog)
--     keeps reading as sent via the queue clause; and
--   * forward compatible — the new lane path reads as sent via the lane clause.
-- comment_queue stays dormant (retired later), so the queue clause simply ages
-- out; nothing has to be deployed in a particular order for this to be correct.
--
-- Three functions, minimal changes, same signatures:
--   1. edit_review_comment  — untouched now also requires lane='backlog'.
--   2. delete_review_thread — same untouched clause.
--   3. list_review_comments — is_sent = (lane<>'backlog') OR queue-row-exists.
--
-- REAL-ENV GATE (rolled-back txn): a backlog comment is editable/deletable by
-- its author; the SAME comment moved to ready_for_agent (lane, no queue row) is
-- NOT; a legacy queued comment stays locked; is_sent reflects the lane.
-- get_advisors(security) clean after.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. edit_review_comment — AUTHOR AND untouched (open, no replies, still backlog
--    AND no legacy queue row).
-- ---------------------------------------------------------------------------
create or replace function public.edit_review_comment(
  p_comment_id uuid,
  p_note       text,
  p_image_refs text[] default '{}'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := (select auth.uid());
  v_caller    uuid;
  v_member    uuid;
  v_preview   uuid;
  v_status    text;
  v_lane      text;
  v_is_author boolean := false;
  v_untouched boolean := false;
  v_note      text := btrim(coalesce(p_note, ''));
  v_images    text[] := coalesce(p_image_refs, '{}');
  v_ref       text;
  c_max_note   constant integer := 10000;  -- generous; creation caps context bytes, not note length
  c_max_images constant integer := 6;  -- mirrors shared MAX_IMAGE_REFS_PER_CARRIER
begin
  if v_uid is null then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  v_caller := v_uid;
  select rs.member_user_id into v_member from public.review_sessions rs
    where rs.anon_user_id = v_uid and rs.expires_at >= now()
    order by rs.expires_at desc limit 1;
  if v_member is not null then v_caller := v_member; end if;

  select c.preview_id, c.status, c.lane, (pt.user_id = v_caller)
    into v_preview, v_status, v_lane, v_is_author
    from public.comments c
    join public.participants pt on pt.id = c.author_participant
    where c.id = p_comment_id;
  if v_preview is null then
    raise exception 'comment_not_found' using errcode = 'P0001';
  end if;

  -- Untouched by others: open, no replies, still in backlog (never sent to the
  -- agent), and no legacy comment_queue row from the pre-lane send path.
  v_untouched := (v_status = 'open')
    and v_lane = 'backlog'
    and not exists (select 1 from public.comment_replies r where r.comment_id = p_comment_id)
    and not exists (select 1 from public.comment_queue q where q.comment_id = p_comment_id);

  -- Author-only (R11): NOT an owner path — a member never edits another's words.
  if not (v_is_author and v_untouched) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  -- A comment must keep a note (removing it entirely = delete the comment).
  if v_note = '' then
    raise exception 'empty_note' using errcode = 'P0001';
  end if;
  if length(v_note) > c_max_note then
    raise exception 'note_too_large' using errcode = 'P0001';
  end if;
  if coalesce(array_length(v_images, 1), 0) > c_max_images then
    raise exception 'too_many_images' using errcode = 'P0001';
  end if;

  -- Hardening (mirrors 0048/0049): pin every image ref to this preview's folder.
  foreach v_ref in array v_images loop
    if v_ref is null
       or v_ref !~ ('^' || v_preview::text || '/[A-Za-z0-9_.-]+\.(png|jpe?g|webp)$') then
      raise exception 'invalid_image_ref' using errcode = 'P0001';
    end if;
  end loop;

  update public.comments
    set note = v_note,
        context = case
          when coalesce(array_length(v_images, 1), 0) = 0
            then (coalesce(context, '{}'::jsonb) - 'referenceImages')
          else jsonb_set(coalesce(context, '{}'::jsonb), '{referenceImages}', to_jsonb(v_images))
        end
    where id = p_comment_id;
end;
$$;

revoke all on function public.edit_review_comment(uuid, text, text[]) from public, anon, authenticated;
grant execute on function public.edit_review_comment(uuid, text, text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. delete_review_thread — OWNER OR (AUTHOR AND untouched), same untouched rule.
-- ---------------------------------------------------------------------------
create or replace function public.delete_review_thread(p_comment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := (select auth.uid());
  v_caller    uuid;
  v_member    uuid;
  v_preview   uuid;
  v_status    text;
  v_lane      text;
  v_is_author boolean := false;
  v_is_owner  boolean := false;
  v_untouched boolean := false;
begin
  if v_uid is null then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  -- Canonical caller id: the member's real uid when reviewing via a session,
  -- else auth.uid() (mirrors delete_review_reply / 0033).
  v_caller := v_uid;
  select rs.member_user_id into v_member from public.review_sessions rs
    where rs.anon_user_id = v_uid and rs.expires_at >= now()
    order by rs.expires_at desc limit 1;
  if v_member is not null then v_caller := v_member; end if;

  select c.preview_id, c.status, c.lane, (pt.user_id = v_caller)
    into v_preview, v_status, v_lane, v_is_author
    from public.comments c
    join public.participants pt on pt.id = c.author_participant
    where c.id = p_comment_id;
  if v_preview is null then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  -- Owner override (resolved member id so an owner reviewing via the overlay
  -- session is recognized, not just the dashboard's direct auth.uid()).
  select exists (
    select 1
    from public.previews pv
    join public.projects pr on pr.id = pv.project_id
    join public.workspace_members wm on wm.workspace_id = pr.workspace_id
    where pv.id = v_preview
      and wm.user_id = v_caller
      and wm.role = 'owner'
  ) into v_is_owner;

  -- Untouched by others: open, no replies, still backlog, no legacy queue row.
  v_untouched := (v_status = 'open')
    and v_lane = 'backlog'
    and not exists (select 1 from public.comment_replies r where r.comment_id = p_comment_id)
    and not exists (select 1 from public.comment_queue q where q.comment_id = p_comment_id);

  if not (v_is_owner or (v_is_author and v_untouched)) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  delete from public.comments where id = p_comment_id;
end;
$$;

revoke all on function public.delete_review_thread(uuid) from public, anon, authenticated;
grant execute on function public.delete_review_thread(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. list_review_comments — is_sent = lane left backlog OR a legacy queue row.
--    Same signature/return type as 0050, so CREATE OR REPLACE (no DROP).
-- ---------------------------------------------------------------------------
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
  is_sent           boolean
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
    -- Sent to the agent = moved out of backlog (lane path) OR a legacy
    -- comment_queue row exists (pre-lane send path). Either locks edit/delete.
    (c.lane <> 'backlog'
      or exists (select 1 from public.comment_queue q where q.comment_id = c.id)) as is_sent
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
