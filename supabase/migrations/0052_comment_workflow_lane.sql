-- =============================================================================
-- 0052_comment_workflow_lane.sql — Kanban workflow lane for comments (U1/U3/U4)
-- =============================================================================
-- Gives every comment a workflow LANE tracking it through the review→agent→
-- review→done loop. This is a pipeline, not a topic taxonomy. Everything starts
-- in Backlog and is moved afterward; the composer gets no new field.
--
--   Post ─► backlog ─►(dev)─► ready_for_agent ─►(dev approves)─► in_review ─► Done
--                               ▲   │
--                               └───┘ dev iterates with the agent
--
-- KEY DECISION — lane is a NEW column; done/dismissed stay on `status`, so the
-- two can never disagree (no dual-truth):
--   * comments.status (unchanged): open | resolved | dismissed.
--       resolved  == Done.
--       dismissed == won't-do side exit (untouched by this feature).
--   * comments.lane (NEW): backlog | ready_for_agent | in_review. Only
--       meaningful while status='open'. THREE values, not four — "Done" is not a
--       lane, it is status='resolved'. The displayed lane is a projection:
--         dismissed → 'dismissed'; resolved → 'done'; else → comments.lane.
--   Consequence: resolve_comment / dismiss_comment / reopen are all untouched;
--   the lane column is only ever written for the backlog→ready_for_agent→
--   in_review progression, so it can never encode (and thus never disagree with)
--   the terminal states.
--
-- THE "SEND TO AGENT" MERGE — "ready_for_agent" IS the agent's work queue.
-- send_comment_to_agent (0044) is ~80% of this already: it gates on the member's
-- can_send_to_agent, enforces the guest-confirm step, and unlocks a guest's
-- reference images via agent_reference_confirmations — but its final wire (the
-- comment_queue row) drains into a no-op sink and the MCP tools ignore the queue
-- entirely, listing ALL open comments. set_comment_lane below subsumes that RPC
-- MINUS the dead comment_queue insert: the lane is the queue (pull model), so no
-- background worker is needed. comment_queue is left dormant (no writes, no
-- data loss); the MCP agent's work list narrows to lane='ready_for_agent' in a
-- later unit. The backfill here preserves already-sent intent.
--
-- Three DB changes:
--   1. comments.lane (+ check) and comments.review_summary columns; a partial
--      index on (preview_id, lane) where status='open'; backfill in-flight
--      queue rows to ready_for_agent so nothing already sent is lost.
--   2. set_comment_lane — one RPC for the backlog↔ready_for_agent↔in_review
--      moves. For ready_for_agent it reuses send_comment_to_agent's exact gate
--      (can_send_to_agent + guest-confirm + reference unlock) minus the queue
--      insert; for backlog/in_review it is member-only.
--   3. mark_comment_in_review — the dev-approved promotion (lane=in_review +
--      an optional agent "what changed" review_summary shown to the reviewer).
--
-- House style mirrors 0044/0050: SECURITY DEFINER + `set search_path = ''` +
-- schema-qualified identifiers + REVOKE from public/anon/authenticated then a
-- targeted GRANT to authenticated only (guests authenticate AS `authenticated`
-- via anonymous sign-in, so the function BODY must reject a guest session
-- itself). Non-breaking: `lane` is additive with a constant default, so it is a
-- metadata-only add (no table rewrite) and every existing row stays valid.
--
-- REAL-ENV GATE: validate in a ROLLED-BACK transaction with role impersonation
-- (dashboard member, overlay member session, overlay guest session) BEFORE
-- apply; then get_advisors(security) after.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Columns + index + backfill (U1).
-- ---------------------------------------------------------------------------
-- `lane` — the open-comment workflow stage. Constant default → fast add.
alter table public.comments
  add column if not exists lane text not null default 'backlog'
    check (lane in ('backlog', 'ready_for_agent', 'in_review'));

-- `review_summary` — the agent's short "what changed" note, set when a comment
-- is promoted to in_review (mark_comment_in_review). Shown to the reviewer on
-- the Ready-for-review card. Optional (NULL when not provided).
alter table public.comments
  add column if not exists review_summary text;

-- Preserve already-sent intent: any comment with an active (pending/working)
-- comment_queue row was "sent", so it belongs in the agent's queue lane. Done
-- BEFORE anything reads `lane`, so no in-flight hand-off is silently dropped
-- when the MCP list narrows to ready_for_agent.
update public.comments c
set lane = 'ready_for_agent'
from public.comment_queue q
where q.comment_id = c.id
  and q.status in ('pending', 'working')
  and c.status = 'open';

-- Lane filtering + per-lane counts are always scoped to open comments of one
-- preview (the dashboard board / overlay filter), so a partial index keyed on
-- (preview_id, lane) covers them without indexing terminal rows.
create index if not exists comments_lane_idx
  on public.comments (preview_id, lane)
  where status = 'open';

-- ---------------------------------------------------------------------------
-- 2. set_comment_lane — backlog ↔ ready_for_agent ↔ in_review (U3).
--
-- Subsumes send_comment_to_agent (0044) for the ready_for_agent transition,
-- MINUS the comment_queue insert. Identity is resolved session-or-member and a
-- guest session is rejected outright: lane moves are a member (team) action.
-- ---------------------------------------------------------------------------
create or replace function public.set_comment_lane(
  p_comment_id    uuid,
  p_lane          text,
  p_confirm_guest boolean default false
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid         uuid := (select auth.uid());
  v_preview     uuid;
  v_status      text;
  v_trust_level text;
  v_session     public.review_sessions%rowtype;
  v_member_uid  uuid;
  v_can_send    boolean := false;
begin
  if v_uid is null then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  if p_lane not in ('backlog', 'ready_for_agent', 'in_review') then
    raise exception 'invalid_lane' using errcode = 'P0001';
  end if;

  select c.preview_id, c.status, c.trust_level
    into v_preview, v_status, v_trust_level
  from public.comments c
  where c.id = p_comment_id;

  if v_preview is null then
    raise exception 'comment_not_found' using errcode = 'P0001';
  end if;

  -- Lane is only meaningful while open; the terminal states (Done/Dismissed)
  -- are owned by resolve_comment / dismiss_comment, never by a lane move.
  if v_status <> 'open' then
    raise exception 'comment_not_open' using errcode = 'P0001';
  end if;

  -- Session-or-member identity (mirrors send_comment_to_agent/0044). A GUEST
  -- session (role <> 'member', or no member_user_id) falls through and is
  -- rejected — it never reaches is_preview_workspace_member.
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

  if p_lane = 'ready_for_agent' then
    -- Hand-off to the agent's work queue: reuse send_comment_to_agent's gate.
    -- The resolved MEMBER (never the overlay's raw anon uid) must hold
    -- can_send_to_agent for this preview's workspace. Inline, not
    -- can_user_send_to_agent(preview_id), which reads auth.uid() directly and
    -- for the overlay session path is the anon id, not v_member_uid.
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
    -- blocked unless explicitly confirmed. Same errcode as
    -- send_comment_to_agent so the web route maps it to its existing 409.
    if v_trust_level = 'guest' and coalesce(p_confirm_guest, false) is not true then
      raise exception 'guest_confirm_required' using errcode = 'P0002';
    end if;

    -- Reference-image unlock (guest-authored only), exactly as
    -- send_comment_to_agent. Idempotent: each explicit re-send re-confirms
    -- as-of-now, which is what the guest reply-image recency gate (R19) wants —
    -- images appended after this instant stay withheld until the next re-send.
    if v_trust_level = 'guest' then
      insert into public.agent_reference_confirmations
        (comment_id, preview_id, confirmed_by, confirmed_at)
      values
        (p_comment_id, v_preview, v_member_uid, now())
      on conflict (comment_id) do update
        set confirmed_by = excluded.confirmed_by,
            confirmed_at = excluded.confirmed_at;
    end if;
  end if;
  -- backlog / in_review: member-only, no further gate (identity resolved above).

  update public.comments set lane = p_lane where id = p_comment_id;
  return p_lane;
end;
$$;

revoke all on function public.set_comment_lane(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.set_comment_lane(uuid, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. mark_comment_in_review — the dev-approved promotion (U4).
--
-- Member-only. Sets lane='in_review' and stores the agent's optional short
-- "what changed" note in review_summary (shown to the reviewer). Callable from
-- MCP and dashboard/overlay. A NULL/blank p_summary preserves any existing
-- summary rather than wiping it (re-marking without a note is not a "clear").
-- ---------------------------------------------------------------------------
create or replace function public.mark_comment_in_review(
  p_comment_id uuid,
  p_summary    text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := (select auth.uid());
  v_preview    uuid;
  v_status     text;
  v_session    public.review_sessions%rowtype;
  v_member_uid uuid;
  v_summary    text := nullif(btrim(coalesce(p_summary, '')), '');
begin
  if v_uid is null then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select c.preview_id, c.status into v_preview, v_status
  from public.comments c
  where c.id = p_comment_id;

  if v_preview is null then
    raise exception 'comment_not_found' using errcode = 'P0001';
  end if;
  if v_status <> 'open' then
    raise exception 'comment_not_open' using errcode = 'P0001';
  end if;

  -- Member-only (session-or-membership); a guest session is rejected.
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

  update public.comments
    set lane = 'in_review',
        review_summary = coalesce(v_summary, review_summary)
    where id = p_comment_id;
  return 'in_review';
end;
$$;

revoke all on function public.mark_comment_in_review(uuid, text) from public, anon, authenticated;
grant execute on function public.mark_comment_in_review(uuid, text) to authenticated;
