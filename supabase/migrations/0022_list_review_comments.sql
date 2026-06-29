-- =============================================================================
-- 0022_list_review_comments.sql — Embedded Deployed Review Mode (U12)
-- =============================================================================
-- The READ half of embedded review mode. The overlay is otherwise write-only
-- (0019 create_review_comment); this RPC lets an ACTIVATED reviewer read back the
-- preview's comments so they can be re-anchored (U8) and rendered as markers on
-- the live deploy (R12).
--
-- AUTH / SCOPE — mirrors 0019/0020 create_review_comment EXACTLY:
--   Authorizes on the caller's anon SESSION JWT. Requires an UNEXPIRED
--   review_sessions row for (anon_user_id = auth.uid(), preview_id =
--   p_preview_id), else raises 'no_review_session' (42501). The session is the
--   authority — the client asserts nothing. Results are scoped STRICTLY to
--   p_preview_id, so a session for preview X can NEVER read preview Y (no
--   cross-preview read): the preview is both the session lookup key AND the
--   comment filter.
--
-- INTENTIONAL EXPOSURE: a guest in a guest_link review may read ALL comments on
--   THAT preview — the shared thread is the product (R12). This is a narrow,
--   preview-scoped exposure enforced by the review session, NOT a broad anon
--   SELECT: 0002's comments SELECT policy stays authenticated/member-only, and
--   this SECURITY DEFINER function (which bypasses RLS) is the only
--   guest-readable path — and it is gated on the session.
--
-- House style mirrors 0019/0020/0003: SECURITY DEFINER + `set search_path = ''`
-- + fully schema-qualified identifiers + REVOKE from public + targeted GRANT to
-- `authenticated` (the anon reviewer IS authenticated via its anon JWT, with
-- is_anonymous = true).
--
-- NOTE on numbering: 0012-0014 are the hardening branch's; this embedded series
-- runs 0016-0022. (The plan named this 0021, but 0020 caps + 0021 cleanup landed
-- first, so the list RPC is 0022.)
-- =============================================================================

create or replace function public.list_review_comments(
  p_preview_id uuid
)
returns table (
  number       integer,
  intent       text,
  severity     text,
  note         text,
  status       text,
  is_stale     boolean,
  context      jsonb,
  created_at   timestamptz,
  display_name text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_session public.review_sessions%rowtype;
begin
  if v_uid is null then
    raise exception 'no_review_session' using errcode = '42501';
  end if;

  -- Require an unexpired session for THIS anon user + THIS preview. The same
  -- (auth.uid(), p_preview_id) pair gates the write path in create_review_comment,
  -- so read and write share one authorization rule.
  select * into v_session
  from public.review_sessions rs
  where rs.anon_user_id = v_uid
    and rs.preview_id = p_preview_id;

  if not found or v_session.expires_at < now() then
    raise exception 'no_review_session' using errcode = '42501';
  end if;

  -- All identifiers are table-qualified so the RETURNS TABLE output columns
  -- (number, status, ...) never collide with the source columns (search_path='').
  return query
  select
    c.number,
    c.intent,
    c.severity,
    c.note,
    c.status,
    c.is_stale,
    c.context,
    c.created_at,
    pt.display_name
  from public.comments c
  join public.participants pt on pt.id = c.author_participant
  where c.preview_id = p_preview_id
  order by c.number;
end;
$$;

revoke all on function public.list_review_comments(uuid) from public;
grant execute on function public.list_review_comments(uuid) to authenticated;
