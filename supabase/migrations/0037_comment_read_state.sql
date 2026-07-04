-- 0037 - per-viewer read state (thread-aware unread), keyed on the DURABLE human.
--
-- A receipt is (comment, viewer, last_read_at). The viewer is a member (user_id) or
-- a guest (normalized email) - never the ephemeral participant/anon session, so it
-- survives device switches, session expiry, the 0021 anon purge, and email edits.
-- A thread is unread for a viewer when
--   max(comment.created_at, latest_reply.created_at, comment.status_changed_at) > last_read_at
-- (or there is no receipt). Reopen bumps status_changed_at, so it re-flags unread.
--
-- RLS: MEMBERS read only their own receipts (dashboard). GUESTS never SELECT this
-- table (a guest cannot resolve their own participants.email_ci in a policy -
-- participants_select is member-only, the 0031 trap); they receive last_read_at
-- through the SECURITY DEFINER list_review_comments below. All writes go through the
-- RPCs; identity is always derived from auth.uid()/session, never a parameter.

-- ---------------------------------------------------------------------------
-- status_changed_at: makes reopen detectable (comments has only created_at).
-- ---------------------------------------------------------------------------
alter table public.comments add column if not exists status_changed_at timestamptz;
update public.comments set status_changed_at = created_at where status_changed_at is null;
alter table public.comments alter column status_changed_at set default now();
alter table public.comments alter column status_changed_at set not null;

create or replace function public.bump_status_changed_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status is distinct from old.status then
    new.status_changed_at := now();
  end if;
  return new;
end;
$$;
revoke all on function public.bump_status_changed_at() from public;

create or replace trigger comments_bump_status_changed_at
  before update on public.comments
  for each row execute function public.bump_status_changed_at();

-- ---------------------------------------------------------------------------
-- comment_read_state
-- ---------------------------------------------------------------------------
create table if not exists public.comment_read_state (
  comment_id     uuid not null references public.comments (id) on delete cascade,
  preview_id     uuid not null references public.previews (id) on delete cascade,
  member_user_id uuid references auth.users (id) on delete cascade,
  guest_email_ci text,
  last_read_at   timestamptz not null default now(),
  check ((member_user_id is not null) <> (guest_email_ci is not null))
);
create unique index if not exists comment_read_state_member_uq
  on public.comment_read_state (comment_id, member_user_id) where member_user_id is not null;
create unique index if not exists comment_read_state_guest_uq
  on public.comment_read_state (comment_id, guest_email_ci) where guest_email_ci is not null;
create index if not exists comment_read_state_preview_idx
  on public.comment_read_state (preview_id);

alter table public.comment_read_state enable row level security;

drop policy if exists "read own member receipts" on public.comment_read_state;
create policy "read own member receipts"
  on public.comment_read_state for select to authenticated
  using (
    member_user_id = (select auth.uid())
    and public.is_preview_workspace_member(preview_id)
  );
-- No insert/update/delete policies: writes go only through the RPCs below.

grant select on public.comment_read_state to authenticated;

-- ---------------------------------------------------------------------------
-- Identity + mark RPCs
-- ---------------------------------------------------------------------------

-- current_review_email - the caller's guest email for a preview (NULL if member or
-- no email yet). SECURITY DEFINER so it can read participants (member-only RLS);
-- leaks nothing but the caller's own email.
create or replace function public.current_review_email(p_preview_id uuid)
returns text language plpgsql security definer stable set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_email text;
begin
  if v_uid is null then return null; end if;
  select pt.email_ci into v_email from public.participants pt
    where pt.preview_id = p_preview_id and pt.user_id = v_uid limit 1;
  return v_email;
end;
$$;
revoke all on function public.current_review_email(uuid) from public, anon;
grant execute on function public.current_review_email(uuid) to authenticated;

-- Resolve the caller's DURABLE identity for a preview from the session (overlay) or
-- workspace membership (dashboard). Sets exactly one of v_member / v_email, or leaves
-- both null for a guest who has not given an email yet (mark = no-op, never error).
-- Raises not_authorized when the caller has no session and is not a member.
create or replace function public.mark_thread_read(p_comment_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_preview uuid;
  v_session public.review_sessions%rowtype;
  v_member uuid;
  v_email text;
begin
  if v_uid is null then raise exception 'not_authorized' using errcode = '42501'; end if;
  select c.preview_id into v_preview from public.comments c where c.id = p_comment_id;
  if v_preview is null then raise exception 'comment_not_found' using errcode = 'P0001'; end if;

  select * into v_session from public.review_sessions rs
    where rs.anon_user_id = v_uid and rs.preview_id = v_preview;
  if found and v_session.expires_at >= now() then
    if v_session.role = 'member' then
      v_member := coalesce(v_session.member_user_id, v_uid);
    else
      select pt.email_ci into v_email from public.participants pt
        where pt.preview_id = v_preview and pt.user_id = v_uid limit 1;
    end if;
  elsif public.is_preview_workspace_member(v_preview) then
    v_member := v_uid;
  else
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  if v_member is null and v_email is null then return; end if;

  if v_member is not null then
    insert into public.comment_read_state (comment_id, preview_id, member_user_id, last_read_at)
      values (p_comment_id, v_preview, v_member, now())
      on conflict (comment_id, member_user_id) where member_user_id is not null
      do update set last_read_at = now();
  else
    insert into public.comment_read_state (comment_id, preview_id, guest_email_ci, last_read_at)
      values (p_comment_id, v_preview, v_email, now())
      on conflict (comment_id, guest_email_ci) where guest_email_ci is not null
      do update set last_read_at = now();
  end if;
end;
$$;
revoke all on function public.mark_thread_read(uuid) from public, anon;
grant execute on function public.mark_thread_read(uuid) to authenticated;

-- mark_thread_unread - delete the caller's receipt (no receipt == unread), same
-- identity resolution as mark_thread_read.
create or replace function public.mark_thread_unread(p_comment_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_preview uuid;
  v_session public.review_sessions%rowtype;
  v_member uuid;
  v_email text;
begin
  if v_uid is null then raise exception 'not_authorized' using errcode = '42501'; end if;
  select c.preview_id into v_preview from public.comments c where c.id = p_comment_id;
  if v_preview is null then raise exception 'comment_not_found' using errcode = 'P0001'; end if;

  select * into v_session from public.review_sessions rs
    where rs.anon_user_id = v_uid and rs.preview_id = v_preview;
  if found and v_session.expires_at >= now() then
    if v_session.role = 'member' then
      v_member := coalesce(v_session.member_user_id, v_uid);
    else
      select pt.email_ci into v_email from public.participants pt
        where pt.preview_id = v_preview and pt.user_id = v_uid limit 1;
    end if;
  elsif public.is_preview_workspace_member(v_preview) then
    v_member := v_uid;
  else
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  if v_member is not null then
    delete from public.comment_read_state
      where comment_id = p_comment_id and member_user_id = v_member;
  elsif v_email is not null then
    delete from public.comment_read_state
      where comment_id = p_comment_id and guest_email_ci = v_email;
  end if;
end;
$$;
revoke all on function public.mark_thread_unread(uuid) from public, anon;
grant execute on function public.mark_thread_unread(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Author auto-read seed: best-effort AFTER INSERT on comments + replies, so the
-- author's own thread starts read for them. Exception-wrapped so a receipt hiccup
-- can NEVER roll back the comment/reply write or its atomic numbering.
-- ---------------------------------------------------------------------------
-- SECURITY INVOKER: inserts run inside the SECURITY DEFINER write RPCs, i.e. as the
-- table owner, which bypasses comment_read_state RLS; and the body is exception-wrapped,
-- so even an unexpected non-owner path silently no-ops rather than breaking the write.
-- Keeping it INVOKER avoids exposing a definer function as an RPC.
create or replace function public.seed_author_read()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_comment_id uuid;
  v_preview    uuid;
  v_user       uuid;
  v_email      text;
  v_trust      text;
begin
  if tg_table_name = 'comments' then
    v_comment_id := new.id; v_preview := new.preview_id;
  else
    v_comment_id := new.comment_id; v_preview := new.preview_id;
  end if;

  select pt.user_id, pt.email_ci, pt.trust_level into v_user, v_email, v_trust
    from public.participants pt where pt.id = new.author_participant;

  if v_trust = 'member' and v_user is not null then
    insert into public.comment_read_state (comment_id, preview_id, member_user_id, last_read_at)
      values (v_comment_id, v_preview, v_user, now())
      on conflict (comment_id, member_user_id) where member_user_id is not null
      do update set last_read_at = greatest(public.comment_read_state.last_read_at, excluded.last_read_at);
  elsif v_email is not null then
    insert into public.comment_read_state (comment_id, preview_id, guest_email_ci, last_read_at)
      values (v_comment_id, v_preview, v_email, now())
      on conflict (comment_id, guest_email_ci) where guest_email_ci is not null
      do update set last_read_at = greatest(public.comment_read_state.last_read_at, excluded.last_read_at);
  end if;
  return null;
exception when others then
  return null;
end;
$$;
revoke all on function public.seed_author_read() from public;

create or replace trigger comments_seed_author_read
  after insert on public.comments
  for each row execute function public.seed_author_read();
create or replace trigger replies_seed_author_read
  after insert on public.comment_replies
  for each row execute function public.seed_author_read();

-- ---------------------------------------------------------------------------
-- list_review_comments: add path + status_changed_at + latest_reply_at + the
-- CALLER's last_read_at (caller-scoped join, so no other viewer's receipt leaks and
-- rows never duplicate). This is the overlay's bulk unread source. Email is NOT added
-- (this path is guest-readable). RETURNS TABLE change requires DROP first.
-- ---------------------------------------------------------------------------
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
  last_read_at      timestamptz
)
language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := (select auth.uid());
  v_session public.review_sessions%rowtype;
  v_member  uuid;
  v_email   text;
begin
  if v_uid is null then raise exception 'no_review_session' using errcode = '42501'; end if;

  select * into v_session from public.review_sessions rs
    where rs.anon_user_id = v_uid and rs.preview_id = p_preview_id;
  if not found or v_session.expires_at < now() then
    raise exception 'no_review_session' using errcode = '42501';
  end if;

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
    crs.last_read_at
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
