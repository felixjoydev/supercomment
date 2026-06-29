-- =============================================================================
-- 0019_review_sessions.sql — Embedded Deployed Review Mode (U3)
-- =============================================================================
-- The token→session exchange + the session-scoped write path.
--
-- FLOW (see the overlay auth/session.ts + apps/web/app/api/review-token/exchange):
--   1. /s mints a short-lived single-use review_tokens row (0018) and redirects
--      the reviewer to their deploy origin with the opaque token in the fragment.
--   2. The embedded overlay does an anonymous Supabase sign-in (raw fetch) to get
--      an anon JWT (sub = anon auth.users id), then POSTs the token + that bearer
--      to /api/review-token/exchange.
--   3. The exchange route VERIFIES the bearer (→ anon uid) and calls
--      establish_review_session(token, anon_uid), which consumes the token and
--      upserts a preview-scoped review_sessions row.
--   4. Writes go through create_review_comment via the anon JWT: it requires an
--      unexpired review_sessions row for (auth.uid(), preview) and derives
--      trust_level / display_name / member attribution FROM that session — the
--      client never asserts its own trust level (closes the guest→member spoof).
--
-- House style mirrors 0003 (create_guest_comment) and 0018 (review_tokens):
-- SECURITY DEFINER + `set search_path = ''` + fully schema-qualified identifiers
-- + REVOKE from public + targeted GRANTs. Atomic per-preview numbering reuses the
-- `UPDATE previews SET comment_seq = comment_seq + 1 ... RETURNING` pattern.
--
-- NOTE on numbering: 0012-0014 are the hardening branch's; this embedded series
-- runs 0016, 0017, 0018, 0019.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- review_sessions — a preview-scoped session bound to an anonymous Supabase
-- user. One row per (anon_user_id, preview_id). `member_user_id` records the
-- real team member when the reviewer authenticated first-party at /s (the anon
-- JWT is still what authorizes, so a full member credential never reaches the
-- customer origin); guests leave it null. `expires_at` is the session lifetime
-- (8h), independent of the 90s single-use token that established it.
-- ---------------------------------------------------------------------------
create table if not exists public.review_sessions (
  id             uuid primary key default gen_random_uuid(),
  anon_user_id   uuid not null,
  preview_id     uuid not null references public.previews (id) on delete cascade,
  role           text not null check (role in ('member', 'guest')),
  member_user_id uuid references auth.users (id) on delete set null,
  display_name   text not null,
  expires_at     timestamptz not null,
  created_at     timestamptz not null default now(),
  unique (anon_user_id, preview_id)
);

create index if not exists review_sessions_anon_preview_idx
  on public.review_sessions (anon_user_id, preview_id);
create index if not exists review_sessions_preview_id_idx
  on public.review_sessions (preview_id);

-- ---------------------------------------------------------------------------
-- establish_review_session — consume a single-use token + open a session.
--   Called by the exchange route via an anon-key client AFTER it has verified
--   the caller's anon JWT (p_anon_user_id is that verified anon uid). The token
--   must exist, be unused, and be unexpired, else `invalid_token`. The row is
--   locked FOR UPDATE so a concurrent replay of the same token loses the race.
--   Returns the preview + role + display_name the overlay persists + renders.
-- ---------------------------------------------------------------------------
create or replace function public.establish_review_session(
  p_token        text,
  p_anon_user_id uuid
)
returns table (preview_id uuid, role text, display_name text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token public.review_tokens%rowtype;
begin
  if p_anon_user_id is null then
    raise exception 'invalid_token' using errcode = 'P0001';
  end if;

  -- Lock the token row so single-use is enforced under concurrency.
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

  return query
  select v_token.preview_id, v_token.role, v_token.display_name;
end;
$$;

revoke all on function public.establish_review_session(text, uuid) from public;
grant execute on function public.establish_review_session(text, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- create_review_comment — the session-scoped write path (NOT anon-key + link
--   secret). Authorizes on the caller's anon JWT: requires an unexpired
--   review_sessions row for (auth.uid(), p_preview_id) else `no_review_session`.
--   trust_level + display_name + member attribution come FROM the session, never
--   the client. Members are attributed to their real account (member_user_id);
--   guests to the anon user. Same atomic numbering as create_guest_comment.
--   Returns the full inserted comments row (number + id among the fields).
--
--   Granted to `authenticated`: the anonymous reviewer IS authenticated via its
--   anon JWT (Supabase anonymous sign-ins get the `authenticated` role with
--   is_anonymous = true).
-- ---------------------------------------------------------------------------
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
  v_comment     public.comments%rowtype;
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
