-- =============================================================================
-- 0043_agent_prompt.sql — member-only "prompt to the agent" per comment (U2)
-- =============================================================================
-- A prompt is a MEMBER-authored trusted instruction attached to a comment,
-- distinct from the thread body (which may include untrusted guest/reviewer
-- text). It exists as its own table -- not a column on `comments` -- so it can
-- carry its own RLS (member-only, no guest branch at all) independent of the
-- comment's own guest-writable thread, and so it is trivially excluded from the
-- realtime broadcast (0004/0038 broadcast full `comments`/`comment_replies` rows
-- to a topic guests subscribe to; a member's private instruction must never ride
-- that trigger or that publication).
--
-- Shape mirrors comment_replies (0033, session-or-member identity + denormalized
-- author) and comment_read_state (0037, member-only table + member_user_id
-- identity) -- but NOT comment_read_state's author-scoped SELECT predicate: ANY
-- workspace member may read AND edit the prompt (R3), there is no per-viewer
-- scoping and no session branch on the read policy.
--
-- Access shape (deliberately asymmetric, see the landmine notes below):
--   * SELECT policy   : is_preview_workspace_member(preview_id) alone. Serves the
--     DASHBOARD (a real authenticated member, no review_sessions row) directly.
--   * No write policies at all. All writes go through set_agent_prompt below.
--   * get_agent_prompt: a SECURITY DEFINER READ RPC. The member-only SELECT
--     policy above canNOT serve the OVERLAY's anonymous session uid --
--     is_preview_workspace_member evaluates auth.uid(), which for the overlay is
--     the anonymous sign-in id, never the real member -- so the overlay needs a
--     definer function that resolves the review_sessions linkage to find the
--     real member and read on their behalf.
--   * set_agent_prompt: a SECURITY DEFINER WRITE RPC granted to `authenticated`.
--     Guests authenticate AS `authenticated` (anonymous sign-in), so grant-
--     absence is not a boundary here -- the function BODY must itself reject a
--     guest session. It does: a `role = 'guest'` review_sessions row (or no
--     session and no workspace membership) raises `not_authorized`.
--
-- "Clear" semantics (load-bearing for U4/U5/U6): an empty/whitespace body
-- DELETES the row rather than storing an empty string. A subsequent read is
-- then a clean zero-rows case ("no prompt" and "cleared prompt" are the same
-- state), matching how get_agent_prompt / the SELECT policy naturally behave
-- for a comment that never had a prompt.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Table. One row per comment; `preview_id` is denormalized from the comment at
-- write time (inside the RPC, not a trigger -- no other table in this codebase
-- backfills a denormalized preview_id via trigger; comment_replies/comment_read_state
-- both set it directly in their write RPCs) so RLS never needs a join to
-- `comments`. `member_user_id` is SET NULL (not cascaded) on author deletion --
-- the prompt is meant to survive the author leaving -- while `author_display_name`
-- keeps showing who (last) wrote it, mirroring comment_replies' denormalized
-- author name.
-- ---------------------------------------------------------------------------
create table if not exists public.agent_prompts (
  id                   uuid primary key default gen_random_uuid(),
  comment_id           uuid not null unique references public.comments (id) on delete cascade,
  preview_id           uuid not null references public.previews (id) on delete cascade,
  body                 text not null check (char_length(body) between 1 and 4000),
  member_user_id       uuid references auth.users (id) on delete set null,
  author_display_name  text not null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists agent_prompts_preview_idx on public.agent_prompts (preview_id);

-- ---------------------------------------------------------------------------
-- RLS. All-members read (not author-scoped, no session branch -- deliberately
-- different from comment_read_state). No write policies: writes only via the
-- RPCs below. Grant paired with the policy (policy-without-grant is a known
-- silent-failure class in this codebase).
-- ---------------------------------------------------------------------------
alter table public.agent_prompts enable row level security;

drop policy if exists "agent prompts readable by workspace members" on public.agent_prompts;
create policy "agent prompts readable by workspace members"
  on public.agent_prompts for select to authenticated
  using (public.is_preview_workspace_member(preview_id));
-- No insert/update/delete policies: writes go only through set_agent_prompt.

grant select on public.agent_prompts to authenticated;

-- ---------------------------------------------------------------------------
-- set_agent_prompt — member-only write (create, edit, or clear).
--
-- Identity resolution mirrors create_review_reply (0033): an active MEMBER
-- review session (the overlay) wins; else a signed-in workspace member
-- (the dashboard, auth.uid() with no session row at all). A GUEST session (or a
-- caller who is neither) is REJECTED -- this is the load-bearing guest-rejection
-- check, since the function is granted to `authenticated` and a guest's anon JWT
-- also carries that role.
--
-- Returns SETOF (not a bare row): a bare `returns public.agent_prompts` with
-- `return null` on the clear path would surface through PostgREST as a single
-- all-NULL row object rather than zero rows -- the exact `claim_next_queue_item`
-- gotcha this codebase already hit once. SETOF + a bare `return;` gives PostgREST
-- (and any RPC caller) a real empty array on clear / not-found.
-- ---------------------------------------------------------------------------
create or replace function public.set_agent_prompt(
  p_comment_id uuid,
  p_body       text
)
returns setof public.agent_prompts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := (select auth.uid());
  v_preview    uuid;
  v_session    public.review_sessions%rowtype;
  v_member_uid uuid;
  v_display    text;
  v_body       text := btrim(coalesce(p_body, ''));
  c_max_body constant integer := 4000;
begin
  if v_uid is null then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select c.preview_id into v_preview from public.comments c where c.id = p_comment_id;
  if v_preview is null then
    raise exception 'comment_not_found' using errcode = 'P0001';
  end if;

  -- Session-or-member identity. A GUEST session (role <> 'member', or no
  -- member_user_id on it) falls through to the `else` and is rejected -- it
  -- never gets to attempt is_preview_workspace_member.
  select * into v_session from public.review_sessions rs
    where rs.anon_user_id = v_uid and rs.preview_id = v_preview;
  if found and v_session.expires_at >= now()
     and v_session.role = 'member' and v_session.member_user_id is not null then
    v_member_uid := v_session.member_user_id;
    v_display    := v_session.display_name;
  elsif public.is_preview_workspace_member(v_preview) then
    v_member_uid := v_uid;
    select coalesce(u.email, 'Member') into v_display from auth.users u where u.id = v_uid;
  else
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  if length(v_body) > c_max_body then
    raise exception 'body_too_large' using errcode = 'P0001';
  end if;

  -- Clear: empty/whitespace body deletes the row (see header note) so a
  -- subsequent read is a clean zero-rows case, same as "never had a prompt".
  if v_body = '' then
    delete from public.agent_prompts where comment_id = p_comment_id;
    return;
  end if;

  return query
  insert into public.agent_prompts as ap
    (comment_id, preview_id, body, member_user_id, author_display_name)
  values
    (p_comment_id, v_preview, v_body, v_member_uid, v_display)
  on conflict (comment_id) do update
    set body                = excluded.body,
        member_user_id      = excluded.member_user_id,
        author_display_name = excluded.author_display_name,
        updated_at          = now()
  returning ap.*;
end;
$$;

revoke all on function public.set_agent_prompt(uuid, text) from public, anon, authenticated;
grant execute on function public.set_agent_prompt(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- get_agent_prompt — role-gated read for the overlay's anon-linked MEMBER
-- session. The member-only SELECT policy above cannot serve this caller (its
-- auth.uid() is the anonymous session id, not the real member), so this definer
-- function resolves the same session-or-member identity as set_agent_prompt and
-- reads on the resolved member's behalf. A GUEST session, a stranger, or a
-- member of a DIFFERENT workspace all just get zero rows back -- quietly, no
-- exception -- matching the "member sessions only" framing (this is a soft
-- preload helper, not a authorization gate that should interrupt a caller).
-- ---------------------------------------------------------------------------
create or replace function public.get_agent_prompt(p_comment_id uuid)
returns setof public.agent_prompts
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_uid       uuid := (select auth.uid());
  v_preview   uuid;
  v_session   public.review_sessions%rowtype;
  v_is_member boolean := false;
begin
  if v_uid is null then
    return;
  end if;

  select c.preview_id into v_preview from public.comments c where c.id = p_comment_id;
  if v_preview is null then
    return;
  end if;

  select * into v_session from public.review_sessions rs
    where rs.anon_user_id = v_uid and rs.preview_id = v_preview;
  if found and v_session.expires_at >= now()
     and v_session.role = 'member' and v_session.member_user_id is not null then
    v_is_member := true;
  elsif public.is_preview_workspace_member(v_preview) then
    v_is_member := true;
  end if;

  if not v_is_member then
    return;
  end if;

  return query select * from public.agent_prompts where comment_id = p_comment_id;
end;
$$;

revoke all on function public.get_agent_prompt(uuid) from public, anon, authenticated;
grant execute on function public.get_agent_prompt(uuid) to authenticated;
