-- =============================================================================
-- 0026_comment_kind.sql — Visual Live-Editing (U3)
-- =============================================================================
-- Adds a `kind` discriminator to comments so a visual-edit "template" (a comment
-- carrying a context.changeSet of direct manipulations, R11/R12) is cheaply
-- distinguishable from an ordinary text comment in the dashboard + MCP, without
-- a separate table. The change-set itself rides the existing context jsonb, so no
-- column is needed for it — only this discriminator.
--
--   kind = 'comment' (default) | 'template'
--
-- Backfill: the column default backfills every existing row to 'comment', so the
-- CHECK holds immediately and older comments are unaffected.
--
-- Also threads p_kind through the EMBEDDED write path (create_review_comment) so
-- the overlay can create a template (U13). The dormant tunnel path
-- (create_guest_comment, 0003) is intentionally left unchanged — templates are an
-- embedded-review feature and the column default keeps tunnel writes valid as
-- 'comment'.
--
-- House style mirrors 0016/0020: additive + idempotent DDL; the RPC keeps
-- SECURITY DEFINER + `set search_path = ''` + schema-qualified identifiers +
-- REVOKE from public + targeted GRANT. The signature CHANGES (adds p_kind), so we
-- DROP the exact 0020 signature and CREATE the new one rather than
-- create-or-replace (which would leave a stale 6-arg overload). PostgREST resolves
-- existing 6-named-arg calls against the new function because p_kind has a default.
--
-- REAL-ENV GATE: validate this migration in a rolled-back transaction against the
-- live DB (and confirm the overlay's existing 6-arg create_review_comment call
-- still resolves) before `supabase db push`.
-- =============================================================================

-- 1. The discriminator column ------------------------------------------------
alter table public.comments
  add column if not exists kind text not null default 'comment';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'comments_kind_check'
  ) then
    alter table public.comments
      add constraint comments_kind_check check (kind in ('comment', 'template'));
  end if;
end $$;

-- Partial index: only template lookups (dashboard filter / MCP) scan by kind;
-- ordinary comments are the overwhelming majority, so index just the templates.
create index if not exists comments_template_idx
  on public.comments (preview_id)
  where kind = 'template';

-- 2. Thread p_kind through the embedded write path ---------------------------
-- Signature change (adds p_kind), so drop the exact 0020 signature first.
drop function if exists public.create_review_comment(uuid, text, text, text, jsonb, text);

create function public.create_review_comment(
  p_preview_id uuid,
  p_intent     text,
  p_severity   text,
  p_note       text,
  p_context    jsonb,
  p_fidelity   text default 'live',
  p_kind       text default 'comment'
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
     intent, severity, note, context, fidelity, kind, is_stale)
  values
    (p_preview_id, v_number, v_participant, v_session.role,
     p_intent, p_severity, p_note,
     coalesce(p_context, '{}'::jsonb), coalesce(nullif(p_fidelity, ''), 'live'),
     coalesce(nullif(p_kind, ''), 'comment'), false)
  returning * into v_comment;

  return v_comment;
end;
$$;

revoke all on function
  public.create_review_comment(uuid, text, text, text, jsonb, text, text)
  from public;
grant execute on function
  public.create_review_comment(uuid, text, text, text, jsonb, text, text)
  to authenticated;
