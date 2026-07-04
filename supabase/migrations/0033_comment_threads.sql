-- 0033 — comment threads: replies, resolve-from-session, and delete.
--
-- A thread is a root `comments` row (which owns all the rich context: screenshot,
-- element, change-set) plus lightweight text `comment_replies` underneath. The
-- back-and-forth lets a developer and a client/reviewer converge; the agent reads
-- the whole thread and the LAST entry is the decisive instruction.
--
-- Permissions (per product):
--   reply / mark-as-done : a guest in an active review session OR a workspace member
--   delete a reply       : the reply's own author (guest or member)
--   delete a whole thread : the workspace OWNER only (protects client feedback)
--
-- All writes go through SECURITY DEFINER RPCs (mirroring create_review_comment);
-- the table exposes only a SELECT policy. `preview_id` and author name/trust are
-- denormalized onto the reply so reads need no join and the RLS predicate needs
-- no join to `comments`.

create table if not exists public.comment_replies (
  id                   uuid primary key default gen_random_uuid(),
  comment_id           uuid not null references public.comments (id) on delete cascade,
  preview_id           uuid not null references public.previews (id) on delete cascade,
  author_participant   uuid not null references public.participants (id),
  author_display_name  text not null,
  trust_level          text not null check (trust_level in ('member', 'guest')),
  body                 text not null,
  created_at           timestamptz not null default now()
);
create index if not exists comment_replies_comment_idx
  on public.comment_replies (comment_id, created_at);

alter table public.comment_replies enable row level security;

-- READ: within an active review session for the preview, OR a workspace member.
drop policy if exists "replies readable within session or as member" on public.comment_replies;
create policy "replies readable within session or as member"
  on public.comment_replies for select to authenticated
  using (
    public.has_active_review_session(preview_id::text)
    or public.is_preview_workspace_member(preview_id)
  );
-- No insert/update/delete policies: those go only through the RPCs below.

-- create_review_reply — a guest (active review session) or a member posts a reply.
create or replace function public.create_review_reply(
  p_comment_id uuid,
  p_body       text
)
returns public.comment_replies
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid         uuid := (select auth.uid());
  v_preview     uuid;
  v_session     public.review_sessions%rowtype;
  v_author_user uuid;
  v_display     text;
  v_role        text;
  v_participant uuid;
  v_reply       public.comment_replies%rowtype;
  c_max_body constant integer := 4000;
begin
  if v_uid is null then
    raise exception 'no_review_session' using errcode = '42501';
  end if;
  if length(coalesce(btrim(p_body), '')) = 0 then
    raise exception 'empty_body' using errcode = 'P0001';
  end if;
  if length(p_body) > c_max_body then
    raise exception 'body_too_large' using errcode = 'P0001';
  end if;

  select c.preview_id into v_preview from public.comments c where c.id = p_comment_id;
  if v_preview is null then
    raise exception 'comment_not_found' using errcode = 'P0001';
  end if;

  -- Attribution: an active review session (guest OR member reviewing) wins; else a
  -- signed-in workspace member (dashboard). Members map to their real account so
  -- overlay and dashboard identity dedupe via the participant.
  select * into v_session from public.review_sessions rs
    where rs.anon_user_id = v_uid and rs.preview_id = v_preview;
  if found and v_session.expires_at >= now() then
    v_author_user := coalesce(v_session.member_user_id, v_uid);
    v_display     := v_session.display_name;
    v_role        := v_session.role;
  elsif public.is_preview_workspace_member(v_preview) then
    v_author_user := v_uid;
    select coalesce(u.email, 'Member') into v_display from auth.users u where u.id = v_uid;
    v_role        := 'member';
  else
    raise exception 'no_review_session' using errcode = '42501';
  end if;

  insert into public.participants as pt (preview_id, user_id, display_name, trust_level)
    values (v_preview, v_author_user, v_display, v_role)
    on conflict (preview_id, user_id) where user_id is not null
    do update set display_name = excluded.display_name
    returning pt.id into v_participant;

  insert into public.comment_replies
    (comment_id, preview_id, author_participant, author_display_name, trust_level, body)
    values (p_comment_id, v_preview, v_participant, v_display, v_role, btrim(p_body))
    returning * into v_reply;
  return v_reply;
end;
$$;
revoke all on function public.create_review_reply(uuid, text) from public;
grant execute on function public.create_review_reply(uuid, text) to authenticated;

-- resolve_review_comment — mark a thread done / reopen it, from the overlay or the
-- dashboard, by a guest OR a member (both may mark as done, per product).
create or replace function public.resolve_review_comment(
  p_comment_id uuid,
  p_resolved   boolean default true
)
returns public.comments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_preview uuid;
  v_session public.review_sessions%rowtype;
  v_comment public.comments%rowtype;
begin
  if v_uid is null then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select c.preview_id into v_preview from public.comments c where c.id = p_comment_id;
  if v_preview is null then
    raise exception 'comment_not_found' using errcode = 'P0001';
  end if;

  select * into v_session from public.review_sessions rs
    where rs.anon_user_id = v_uid and rs.preview_id = v_preview;
  if not (
    (found and v_session.expires_at >= now())
    or public.is_preview_workspace_member(v_preview)
  ) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  update public.comments c
    set status = case when p_resolved then 'resolved' else 'open' end,
        resolved_by = case when p_resolved then v_uid else null end,
        resolved_summary = case when p_resolved
                                then coalesce(c.resolved_summary, 'Marked done')
                                else null end
    where c.id = p_comment_id
    returning * into v_comment;
  return v_comment;
end;
$$;
revoke all on function public.resolve_review_comment(uuid, boolean) from public;
grant execute on function public.resolve_review_comment(uuid, boolean) to authenticated;

-- delete_review_reply — the reply's OWN author (guest or member) deletes it. A
-- member's overlay-session identity and dashboard identity both resolve to their
-- real account via the participant, so either surface can delete their own reply.
create or replace function public.delete_review_reply(p_reply_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_caller uuid;
  v_member uuid;
  v_owner  uuid;
begin
  if v_uid is null then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  -- Canonical caller id: the member's real uid when reviewing via a session, else auth.uid().
  v_caller := v_uid;
  select rs.member_user_id into v_member from public.review_sessions rs
    where rs.anon_user_id = v_uid and rs.expires_at >= now()
    order by rs.expires_at desc limit 1;
  if v_member is not null then v_caller := v_member; end if;

  select pt.user_id into v_owner
    from public.comment_replies r
    join public.participants pt on pt.id = r.author_participant
    where r.id = p_reply_id;
  if v_owner is null or v_owner <> v_caller then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  delete from public.comment_replies where id = p_reply_id;
end;
$$;
revoke all on function public.delete_review_reply(uuid) from public;
grant execute on function public.delete_review_reply(uuid) to authenticated;

-- delete_review_thread — the WORKSPACE OWNER deletes the whole thread (root comment
-- + replies + queue via cascade). Owner only, so a guest or a non-owner member
-- cannot wipe a client's feedback.
create or replace function public.delete_review_thread(p_comment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := (select auth.uid());
  v_is_owner boolean;
begin
  if v_uid is null then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select exists (
    select 1
    from public.comments c
    join public.previews pv on pv.id = c.preview_id
    join public.projects pr on pr.id = pv.project_id
    join public.workspace_members wm on wm.workspace_id = pr.workspace_id
    where c.id = p_comment_id
      and wm.user_id = v_uid
      and wm.role = 'owner'
  ) into v_is_owner;
  if not v_is_owner then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  delete from public.comments where id = p_comment_id;
end;
$$;
revoke all on function public.delete_review_thread(uuid) from public;
grant execute on function public.delete_review_thread(uuid) to authenticated;
