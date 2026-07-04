-- 0036 - guest email: capture (session-gated) + member edit (identity-merge).
--
-- Guests are anonymous and per-device today; to give them "the pages I commented
-- on" and durable per-viewer unread, we key durable state on a normalized email
-- (unverified, trust-on-input). participants.email_ci binds the email to the human.
-- Members can correct a typo'd email from the dashboard; that edit re-points any
-- existing read receipts old->new as an identity merge (greatest-wins) so it never
-- trips the unique(comment_id, guest_email_ci) index that 0037 adds.
--
-- All writes go through SECURITY DEFINER RPCs; the caller's identity is always
-- derived from auth.uid()/session, never from a parameter.

alter table public.participants add column if not exists email_ci text;
create index if not exists participants_preview_email_idx
  on public.participants (preview_id, email_ci) where email_ci is not null;

-- normalize_email - lowercase + trim; NULL if not a plausible address (unverified,
-- so this is a syntactic gate only). One normalizer for capture, edit, and the
-- receipt key so the same human never splits across two spellings.
create or replace function public.normalize_email(p_email text)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_email is null then null
    when lower(btrim(p_email)) ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
      then lower(btrim(p_email))
    else null
  end
$$;
revoke all on function public.normalize_email(text) from public;
grant execute on function public.normalize_email(text) to authenticated;

-- set_guest_email - a guest (active review session) records their email once, at
-- first comment. Upserts the caller's participant (creating it if the first comment
-- has not happened yet), keyed exactly like create_review_comment so it targets the
-- same row. Members may call it too (harmless); the overlay only invokes it for guests.
create or replace function public.set_guest_email(p_preview_id uuid, p_email text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid         uuid := (select auth.uid());
  v_session     public.review_sessions%rowtype;
  v_author_user uuid;
  v_display     text;
  v_role        text;
  v_email_ci    text := public.normalize_email(p_email);
begin
  if v_uid is null then raise exception 'no_review_session' using errcode = '42501'; end if;
  if v_email_ci is null then raise exception 'invalid_email' using errcode = 'P0001'; end if;

  select * into v_session from public.review_sessions rs
    where rs.anon_user_id = v_uid and rs.preview_id = p_preview_id;
  if found and v_session.expires_at >= now() then
    v_author_user := coalesce(v_session.member_user_id, v_uid);
    v_display     := v_session.display_name;
    v_role        := v_session.role;
  elsif public.is_preview_workspace_member(p_preview_id) then
    v_author_user := v_uid;
    select coalesce(u.email, 'Member') into v_display from auth.users u where u.id = v_uid;
    v_role        := 'member';
  else
    raise exception 'no_review_session' using errcode = '42501';
  end if;

  insert into public.participants as pt
    (preview_id, user_id, display_name, trust_level, email_ci)
    values (p_preview_id, v_author_user, v_display, v_role, v_email_ci)
    on conflict (preview_id, user_id) where user_id is not null
    do update set email_ci = excluded.email_ci;
end;
$$;
revoke all on function public.set_guest_email(uuid, text) from public, anon;
grant execute on function public.set_guest_email(uuid, text) to authenticated;

-- set_participant_email - a workspace MEMBER corrects a guest's email from the
-- dashboard. Re-points existing read receipts old->new (identity merge, greatest
-- wins, preview-scoped) so the unique(comment_id, guest_email_ci) index in 0037 is
-- never violated, then updates email_ci on ALL sibling participants sharing the old
-- email on this preview (same human, multiple devices). Guarded with to_regclass so
-- it is safe to define here before 0037 creates comment_read_state.
create or replace function public.set_participant_email(p_participant_id uuid, p_email text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid       uuid := (select auth.uid());
  v_preview   uuid;
  v_old_email text;
  v_new_email text := public.normalize_email(p_email);
begin
  if v_uid is null then raise exception 'not_authorized' using errcode = '42501'; end if;
  if v_new_email is null then raise exception 'invalid_email' using errcode = 'P0001'; end if;

  select preview_id, email_ci into v_preview, v_old_email
    from public.participants where id = p_participant_id;
  if v_preview is null then raise exception 'participant_not_found' using errcode = 'P0001'; end if;
  if not public.is_preview_workspace_member(v_preview) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if v_old_email is not distinct from v_new_email then return; end if;

  if v_old_email is not null and to_regclass('public.comment_read_state') is not null then
    insert into public.comment_read_state (comment_id, preview_id, guest_email_ci, last_read_at)
      select crs.comment_id, crs.preview_id, v_new_email, crs.last_read_at
      from public.comment_read_state crs
      where crs.preview_id = v_preview and crs.guest_email_ci = v_old_email
      on conflict (comment_id, guest_email_ci) where guest_email_ci is not null
      do update set last_read_at = greatest(public.comment_read_state.last_read_at, excluded.last_read_at);
    delete from public.comment_read_state crs
      where crs.preview_id = v_preview and crs.guest_email_ci = v_old_email;
  end if;

  if v_old_email is not null then
    update public.participants set email_ci = v_new_email
      where preview_id = v_preview and email_ci = v_old_email;
  else
    update public.participants set email_ci = v_new_email where id = p_participant_id;
  end if;
end;
$$;
revoke all on function public.set_participant_email(uuid, text) from public, anon;
grant execute on function public.set_participant_email(uuid, text) to authenticated;
