-- =============================================================================
-- 0044_send_comment_to_agent.sql — one atomic send RPC for BOTH surfaces (U3)
-- =============================================================================
-- Today the dashboard route (apps/web/app/api/send-to-claude/route.ts) inserts
-- into comment_queue directly, and the overlay calls a DIFFERENT RPC
-- (enqueue_review_comment, 0029) that has NO guest-confirm gate at all. Neither
-- path captures a per-send snapshot of the live agent_prompt (0043/U2), so a
-- member editing the prompt after a send has no record of what the agent
-- actually saw at send time (R7). This migration replaces both call sites with
-- ONE SECURITY DEFINER RPC that, in a single transaction:
--
--   1. resolves identity session-or-member (mirrors set_agent_prompt/0043 and
--      enqueue_review_comment/0029) and rejects a guest session outright;
--   2. enforces the resolved MEMBER holds can_send_to_agent for the preview's
--      workspace (inline check against the resolved member id — NOT
--      can_user_send_to_agent(preview_id), which reads auth.uid() directly and
--      would wrongly evaluate the overlay's anon session uid instead of the
--      real member it resolved to);
--   3. enforces the guest-confirm gate SERVER-SIDE (closing the overlay's
--      pre-existing gap — R11): a guest-authored comment is rejected unless
--      p_confirm_guest = true;
--   4. reads the live agent_prompt for the comment and, on a genuine new
--      enqueue (not a dedup no-op against an already-active row), stamps a
--      point-in-time snapshot of it onto the new comment_queue row so what the
--      agent was told to look at is auditable even if the prompt is edited
--      later (R7);
--   5. for a GUEST-authored comment only, idempotently marks the confirm
--      marker (a member-authored comment sends with no marker at all — later
--      units, e.g. U7, use the marker's PRESENCE to know a human explicitly
--      cleared a guest reference image for hand-off).
--
-- Dedup semantics (first-wins): the partial unique index from 0006
-- (comment_queue_active_uniq on comment_id where status in
-- ('pending','working')) makes a re-send while a prior attempt is still active
-- a benign no-op; the ALREADY-QUEUED row's snapshot must not be touched by the
-- new call. `insert ... on conflict (...) do nothing returning *` naturally
-- returns zero rows on a conflict, which is exactly how we detect "this call
-- did not insert" and skip snapshot/marker writes.
--
-- Return shape: `returns setof public.comment_queue` (not a bare rowtype) —
-- the same claim_next_queue_item / set_agent_prompt (0043) PostgREST gotcha:
-- a bare rowtype surfaces a "not found" case as a single all-NULL row over
-- PostgREST rather than an empty array. Callers here always expect exactly one
-- row on success (the freshly-inserted OR the existing active row), so this
-- also means "return zero rows" only ever means "no queue row could be
-- resolved", never "here is a row full of nulls".
--
-- House style mirrors 0028/0029/0043: SECURITY DEFINER + `set search_path = ''`
-- + schema-qualified identifiers + REVOKE from public/anon/authenticated then
-- targeted GRANT to authenticated only (guests authenticate AS `authenticated`
-- via anonymous sign-in, so grant-absence alone is not a boundary — the
-- function BODY must reject a guest session itself).
--
-- REAL-ENV GATE: validate in a ROLLED-BACK transaction with role impersonation
-- (dashboard member, overlay member session, guest session) BEFORE apply; then
-- get_advisors(security) after.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. agent_reference_confirmations — member-only "confirmed for agent" marker.
--
-- One row per comment (only ever written for a GUEST-authored comment's send).
-- Shape mirrors agent_prompts (0043): all-members read via
-- is_preview_workspace_member, no write policies (writes only via
-- send_comment_to_agent below), no broadcast trigger, not part of the realtime
-- publication (this is an internal audit/gating fact, not something a guest
-- reviewer's live feed should ever see).
-- ---------------------------------------------------------------------------
create table if not exists public.agent_reference_confirmations (
  id            uuid primary key default gen_random_uuid(),
  comment_id    uuid not null unique references public.comments (id) on delete cascade,
  preview_id    uuid not null references public.previews (id) on delete cascade,
  confirmed_by  uuid references auth.users (id) on delete set null,
  confirmed_at  timestamptz not null default now()
);

create index if not exists agent_reference_confirmations_preview_idx
  on public.agent_reference_confirmations (preview_id);

alter table public.agent_reference_confirmations enable row level security;

drop policy if exists "agent reference confirmations readable by workspace members"
  on public.agent_reference_confirmations;
create policy "agent reference confirmations readable by workspace members"
  on public.agent_reference_confirmations for select to authenticated
  using (public.is_preview_workspace_member(preview_id));
-- No insert/update/delete policies: writes go only through
-- send_comment_to_agent below.

grant select on public.agent_reference_confirmations to authenticated;

-- ---------------------------------------------------------------------------
-- 2. comment_queue — additive, metadata-only snapshot columns (no rewrite of
-- existing rows; NULL for every pre-existing row, which is the correct "no
-- snapshot was ever captured for this old send" reading).
-- ---------------------------------------------------------------------------
alter table public.comment_queue
  add column if not exists prompt_snapshot text,
  add column if not exists prompt_snapshot_author text,
  add column if not exists prompt_snapshot_at timestamptz;

-- ---------------------------------------------------------------------------
-- 3. send_comment_to_agent — the one send RPC for both surfaces.
-- ---------------------------------------------------------------------------
create or replace function public.send_comment_to_agent(
  p_comment_id    uuid,
  p_confirm_guest boolean default false
)
returns setof public.comment_queue
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid          uuid := (select auth.uid());
  v_preview      uuid;
  v_trust_level  text;
  v_session      public.review_sessions%rowtype;
  v_member_uid   uuid;
  v_can_send     boolean := false;
  v_prompt_body  text;
  v_prompt_author text;
  v_row          public.comment_queue%rowtype;
  v_inserted     boolean := false;
begin
  if v_uid is null then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select c.preview_id, c.trust_level into v_preview, v_trust_level
  from public.comments c
  where c.id = p_comment_id;

  if v_preview is null then
    raise exception 'comment_not_found' using errcode = 'P0001';
  end if;

  -- Session-or-member identity (mirrors set_agent_prompt/0043 and
  -- enqueue_review_comment/0029). A GUEST session (role <> 'member', or no
  -- member_user_id on it) falls through to the `else` and is rejected — it
  -- never gets to attempt is_preview_workspace_member.
  select * into v_session from public.review_sessions rs
    where rs.anon_user_id = v_uid and rs.preview_id = v_preview;
  if found and v_session.expires_at >= now()
     and v_session.role = 'member' and v_session.member_user_id is not null then
    v_member_uid := v_session.member_user_id;
  elsif public.is_preview_workspace_member(v_preview) then
    v_member_uid := v_uid;
  else
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  -- The resolved MEMBER (never the overlay's raw anon uid) must be granted
  -- send-to-agent for this preview's workspace. Deliberately inline rather
  -- than calling can_user_send_to_agent(preview_id): that helper reads
  -- auth.uid() directly, which for the overlay session path is the anonymous
  -- session id, not v_member_uid.
  select exists (
    select 1
    from public.previews pv
    join public.projects pr on pr.id = pv.project_id
    join public.workspace_members wm on wm.workspace_id = pr.workspace_id
    where pv.id = v_preview
      and wm.user_id = v_member_uid
      and wm.can_send_to_agent = true
  ) into v_can_send;

  if not v_can_send then
    raise exception 'send_to_agent_forbidden' using errcode = '42501';
  end if;

  -- R23/R11: a guest-authored comment is untrusted to the agent and is
  -- blocked unless explicitly confirmed. Distinct errcode from the plain
  -- authz rejections above so the route can map it to its existing 409 JSON
  -- response instead of a generic 403.
  if v_trust_level = 'guest' and coalesce(p_confirm_guest, false) is not true then
    raise exception 'guest_confirm_required' using errcode = 'P0002';
  end if;

  -- Read the live prompt (system-level read regardless of RLS — this
  -- function is SECURITY DEFINER and reads the base table directly) so a
  -- genuinely new enqueue can carry it as a point-in-time snapshot (R7).
  select ap.body, ap.author_display_name into v_prompt_body, v_prompt_author
  from public.agent_prompts ap
  where ap.comment_id = p_comment_id;

  -- Enqueue. The partial unique index (0006) makes a re-send while a prior
  -- attempt is still pending/working a benign no-op: `on conflict ... do
  -- nothing returning *` yields zero rows here, which is how we tell "this
  -- call actually inserted" from "an active row already existed" — the
  -- snapshot/marker below must NOT run on the no-op path (first-wins).
  insert into public.comment_queue as cq
    (preview_id, comment_id, requested_by, status,
     prompt_snapshot, prompt_snapshot_author, prompt_snapshot_at)
  values
    (v_preview, p_comment_id, v_member_uid, 'pending',
     v_prompt_body, v_prompt_author,
     case when v_prompt_body is not null then now() else null end)
  on conflict (comment_id) where status in ('pending', 'working') do nothing
  returning cq.* into v_row;

  v_inserted := found;

  if v_inserted then
    -- Only a GUEST-authored comment gets a confirm marker; a member-authored
    -- send writes none at all (member rasters resolve regardless, per later
    -- units — this RPC only needs to write the marker correctly, not consume
    -- it). Idempotent upsert: a fresh send after a prior terminal attempt
    -- simply refreshes confirmed_by/confirmed_at.
    if v_trust_level = 'guest' then
      insert into public.agent_reference_confirmations
        (comment_id, preview_id, confirmed_by, confirmed_at)
      values
        (p_comment_id, v_preview, v_member_uid, now())
      on conflict (comment_id) do update
        set confirmed_by = excluded.confirmed_by,
            confirmed_at = excluded.confirmed_at;
    end if;

    return next v_row;
    return;
  end if;

  -- Dedup path: no new row was inserted because an active (pending/working)
  -- one already exists for this comment. Return that existing row untouched
  -- (no snapshot overwrite, no marker write) so the caller still gets a
  -- coherent "it's queued" response.
  return query
  select * from public.comment_queue
  where comment_id = p_comment_id
    and status in ('pending', 'working');
end;
$$;

revoke all on function public.send_comment_to_agent(uuid, boolean) from public, anon, authenticated;
grant execute on function public.send_comment_to_agent(uuid, boolean) to authenticated;
