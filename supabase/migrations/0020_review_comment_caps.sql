-- =============================================================================
-- 0020_review_comment_caps.sql — Embedded Deployed Review Mode (U4 hardening)
-- =============================================================================
-- Server-side abuse caps on the GUEST write path, layered onto the 0019
-- create_review_comment WITHOUT changing its signature, return shape, or any
-- existing behavior. This is the plan-007 cap SHAPE applied fresh on THIS branch
-- (plan-007's 0013 lives on the hardening branch, not here): the rate limit and
-- payload guard MUST live inside the SECURITY DEFINER RPC because any client-side
-- cap is trivially bypassable (the anon JWT can call PostgREST directly).
--
-- Scope is NOT re-added here: 0019's create_review_comment already enforces
-- preview scope (it requires an unexpired review_sessions row for
-- (auth.uid(), p_preview_id) and derives trust/identity FROM that session), so
-- cross-preview writes are already blocked. This migration ONLY adds caps.
--
-- CAPS (guest sessions only — members are exempt):
--   * RATE LIMIT  : max 20 comments per rolling 60s, per guest, per preview.
--                   The 21st within the window raises 'rate_limited' (P0001).
--   * PAYLOAD GUARD: pg_column_size(p_context) > 3 MiB raises
--                   'payload_too_large' (P0001). p_context arrives as an
--                   in-memory jsonb datum, so pg_column_size measures the
--                   UNcompressed binary size (TOAST compression only applies to
--                   stored values) — the threshold is exact, not best-effort.
--
-- CREATE OR REPLACE with the EXACT 0019 signature
--   create_review_comment(uuid, text, text, text, jsonb, text)
-- so we replace the function in place rather than creating an overload.
--
-- House style mirrors 0019/0003: SECURITY DEFINER + `set search_path = ''` +
-- fully schema-qualified identifiers + REVOKE from public + targeted GRANT.
-- =============================================================================

create or replace function public.create_review_comment(
  p_preview_id uuid,
  p_intent     text,
  p_severity   text,
  p_note       text,
  p_context    jsonb,
  p_fidelity   text default 'live'
)
returns public.comments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid         uuid := (select auth.uid());
  v_session     public.review_sessions%rowtype;
  v_author_user uuid;
  v_participant uuid;
  v_number      integer;
  v_recent      integer;
  v_comment     public.comments%rowtype;
  -- 3 MiB. p_context is an in-memory datum here, so pg_column_size is the
  -- uncompressed binary jsonb size (no TOAST compression on non-stored values).
  c_max_context_bytes constant integer := 3 * 1024 * 1024;
  -- Rolling-window abuse cap for guests (per guest, per preview).
  c_rate_window    constant interval := interval '60 seconds';
  c_rate_max       constant integer  := 20;
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

  -- Members are attributed to their real account so dashboard + overlay identity
  -- dedupe; guests are attributed to the anonymous user.
  v_author_user := coalesce(v_session.member_user_id, v_uid);

  -- -------------------------------------------------------------------------
  -- ABUSE CAPS — guest sessions only (members are exempt). Checked BEFORE any
  -- write so a rejected request leaves no participant/number side effects.
  -- -------------------------------------------------------------------------
  if v_session.role = 'guest' then
    -- Payload guard: reject oversized context server-side (client caps bypassable).
    if pg_column_size(coalesce(p_context, '{}'::jsonb)) > c_max_context_bytes then
      raise exception 'payload_too_large' using errcode = 'P0001';
    end if;

    -- Rate limit: count this guest's comments on this preview within the window.
    -- Joins through participants on the anon user (guest participant.user_id =
    -- v_uid) so the count is scoped to this guest + this preview.
    select count(*) into v_recent
    from public.comments c
    join public.participants pt on pt.id = c.author_participant
    where c.preview_id = p_preview_id
      and pt.user_id = v_uid
      and c.created_at > now() - c_rate_window;

    if v_recent >= c_rate_max then
      raise exception 'rate_limited' using errcode = 'P0001';
    end if;
  end if;

  insert into public.participants as pt
    (preview_id, user_id, display_name, trust_level)
  values
    (p_preview_id, v_author_user, v_session.display_name, v_session.role)
  on conflict (preview_id, user_id) where user_id is not null
  do update set display_name = excluded.display_name
  returning pt.id into v_participant;

  -- Atomic per-preview numbering (sequences are not gap-free / transaction-safe).
  update public.previews pv
  set comment_seq = pv.comment_seq + 1
  where pv.id = p_preview_id
  returning pv.comment_seq into v_number;

  insert into public.comments
    (preview_id, number, author_participant, trust_level,
     intent, severity, note, context, fidelity, is_stale)
  values
    (p_preview_id, v_number, v_participant, v_session.role,
     p_intent, p_severity, p_note,
     coalesce(p_context, '{}'::jsonb), coalesce(nullif(p_fidelity, ''), 'live'), false)
  returning * into v_comment;

  return v_comment;
end;
$$;

revoke all on function
  public.create_review_comment(uuid, text, text, text, jsonb, text)
  from public;
grant execute on function
  public.create_review_comment(uuid, text, text, text, jsonb, text)
  to authenticated;
