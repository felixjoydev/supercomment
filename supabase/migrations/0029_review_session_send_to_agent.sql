-- =============================================================================
-- 0029_review_session_send_to_agent.sql — carry send-to-agent into the overlay
-- =============================================================================
-- Phase 2, overlay half. A MEMBER review session (a workspace member reviewing
-- via a members-only review link) may show a "Send to agent" action in the editor
-- footer — but ONLY when that member is granted can_send_to_agent. Guests never.
--
--   1. establish_review_session now also RETURNS can_send_to_agent, computed for
--      the token's member (member_user_id) against the preview's workspace. Guests
--      (no member_user_id) always get false. This is what the /s exchange surfaces
--      to the overlay so the footer can conditionally render the button.
--
--   2. enqueue_review_comment(comment) — the overlay's "Send to agent" action.
--      SECURITY DEFINER, gated on the CALLER holding a live MEMBER review session
--      for the comment's preview whose member is granted send-to-agent; inserts a
--      comment_queue row. The server is the real guard (the footer visibility is
--      UX only). Anonymous reviewers run as the `authenticated` role, so grant
--      authenticated + revoke public/anon.
--
-- House style mirrors 0019/0026/0028: SECURITY DEFINER + `set search_path = ''` +
-- schema-qualified identifiers. establish_review_session's RETURN TYPE changes
-- (adds a column) so it must be DROPped then CREATEd; it stays anon-executable
-- (the /s exchange calls it with an anon-key client).
--
-- REAL-ENV GATE: validate in a ROLLED-BACK txn + get_advisors(security) before
-- apply. The live enqueue → agent round-trip (a member's local MCP draining the
-- queue) is real-env; the permission gate here is testable.
-- =============================================================================

-- 1. establish_review_session — add can_send_to_agent to the return -----------
drop function if exists public.establish_review_session(text, uuid);

create function public.establish_review_session(p_token text, p_anon_user_id uuid)
returns table(
  preview_id uuid,
  role text,
  display_name text,
  can_send_to_agent boolean
)
language plpgsql
security definer
set search_path = ''
as $function$
#variable_conflict use_column
declare
  v_token public.review_tokens%rowtype;
  v_can   boolean := false;
begin
  if p_anon_user_id is null then
    raise exception 'invalid_token' using errcode = 'P0001';
  end if;

  select * into v_token
  from public.review_tokens
  where token = p_token
  for update;

  if not found
     or v_token.used_at is not null
     or v_token.expires_at < now() then
    raise exception 'invalid_token' using errcode = 'P0001';
  end if;

  update public.review_tokens
  set used_at = now()
  where id = v_token.id;

  insert into public.review_sessions
    (anon_user_id, preview_id, role, member_user_id, display_name, expires_at)
  values
    (p_anon_user_id, v_token.preview_id, v_token.role, v_token.member_user_id,
     v_token.display_name, now() + interval '8 hours')
  on conflict (anon_user_id, preview_id)
  do update set
     role           = excluded.role,
     member_user_id = excluded.member_user_id,
     display_name   = excluded.display_name,
     expires_at     = excluded.expires_at;

  -- Only a real member (member_user_id set) can carry the grant; guests → false.
  if v_token.member_user_id is not null then
    select exists (
      select 1
      from public.previews pv
      join public.projects pr on pr.id = pv.project_id
      join public.workspace_members wm on wm.workspace_id = pr.workspace_id
      where pv.id = v_token.preview_id
        and wm.user_id = v_token.member_user_id
        and wm.can_send_to_agent = true
    ) into v_can;
  end if;

  return query
  select v_token.preview_id, v_token.role, v_token.display_name, v_can;
end;
$function$;

-- Called by the /s token exchange with an anon-key client → keep anon-executable.
grant execute on function public.establish_review_session(text, uuid) to anon, authenticated;

-- 2. enqueue_review_comment — the overlay "Send to agent" action --------------
create or replace function public.enqueue_review_comment(p_comment_id uuid)
returns public.comment_queue
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid     uuid := (select auth.uid());
  v_preview uuid;
  v_session public.review_sessions%rowtype;
  v_can     boolean := false;
  v_row     public.comment_queue%rowtype;
begin
  if v_uid is null then
    raise exception 'no_review_session' using errcode = '42501';
  end if;

  select preview_id into v_preview from public.comments where id = p_comment_id;
  if v_preview is null then
    raise exception 'comment_not_found' using errcode = 'P0001';
  end if;

  -- The caller must hold a live MEMBER review session for that preview.
  select * into v_session
  from public.review_sessions
  where anon_user_id = v_uid and preview_id = v_preview;

  if not found
     or v_session.expires_at < now()
     or v_session.role <> 'member'
     or v_session.member_user_id is null then
    raise exception 'not_permitted' using errcode = '42501';
  end if;

  -- …and that member must be granted send-to-agent for the preview's workspace.
  select exists (
    select 1
    from public.previews pv
    join public.projects pr on pr.id = pv.project_id
    join public.workspace_members wm on wm.workspace_id = pr.workspace_id
    where pv.id = v_preview
      and wm.user_id = v_session.member_user_id
      and wm.can_send_to_agent = true
  ) into v_can;
  if not v_can then
    raise exception 'send_to_agent_forbidden' using errcode = '42501';
  end if;

  insert into public.comment_queue (preview_id, comment_id, requested_by, status)
  values (v_preview, p_comment_id, v_session.member_user_id, 'pending')
  returning * into v_row;

  return v_row;
end;
$function$;

revoke all on function public.enqueue_review_comment(uuid) from public, anon, authenticated;
grant execute on function public.enqueue_review_comment(uuid) to authenticated;
