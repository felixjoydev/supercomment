-- security_audit.sql
-- U13 security audit. Asserts the cross-cutting database controls hold:
--   1. RLS is ENABLED on every public table.
--   2. anon LACKS direct execute on the internal SECURITY DEFINER helpers
--      (tightened in 0008) but RETAINS execute on the guest write-path RPCs
--      it legitimately needs.
-- Each failing assert RAISES, aborting with a non-zero result. Run via:
--   psql ... -f supabase/tests/security_audit.sql   (or MCP execute_sql)

-- ---------------------------------------------------------------------------
-- 1. RLS enabled on EVERY public table (dynamic — no hardcoded list).
--    The original check iterated a hardcoded 8-table array. That array predated
--    review_tokens/review_sessions (0018/0019) — so it never noticed they shipped
--    RLS-disabled (C1/C2) — and it still named `teams`/`team_members`, which the
--    0024 rename removed. A dynamic relrowsecurity sweep over pg_class instead
--    fails the moment ANY current-or-future public table forgets
--    `enable row level security`, closing the detection gap that let C1/C2 ship.
-- ---------------------------------------------------------------------------
do $$
declare
  missing text;
begin
  select string_agg(c.relname, ', ' order by c.relname)
    into missing
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'r'          -- ordinary tables only (not views/matviews)
     and not c.relrowsecurity;

  if missing is not null then
    raise exception 'security_audit: RLS is NOT enabled on public table(s): %', missing;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2a. anon must NOT have execute on the internal RLS helpers.
-- ---------------------------------------------------------------------------
do $$
declare
  fn text;
  -- Names are the post-0024 (team -> workspace) rename; is_preview_participant /
  -- is_anon_user / can_subscribe_preview were not renamed.
  internal_helpers text[] := array[
    'public.is_workspace_member(uuid)',
    'public.is_project_workspace_member(uuid)',
    'public.is_preview_workspace_member(uuid)',
    'public.is_preview_participant(uuid)',
    'public.is_anon_user()',
    'public.can_subscribe_preview(text)'
  ];
  oid_ regprocedure;
begin
  foreach fn in array internal_helpers loop
    oid_ := to_regprocedure(fn);
    if oid_ is null then
      raise exception 'security_audit: expected helper % not found', fn;
    end if;
    if has_function_privilege('anon', oid_::oid, 'EXECUTE') then
      raise exception 'security_audit: anon STILL has execute on internal helper %', fn;
    end if;
  end loop;

  -- Guard-wrapped (may be present): is_workspace_admin / allocate_comment_number.
  if to_regprocedure('public.is_workspace_admin(uuid)') is not null then
    if has_function_privilege('anon', to_regprocedure('public.is_workspace_admin(uuid)')::oid, 'EXECUTE') then
      raise exception 'security_audit: anon STILL has execute on is_workspace_admin(uuid)';
    end if;
  end if;
  if to_regprocedure('public.allocate_comment_number(uuid)') is not null then
    if has_function_privilege('anon', to_regprocedure('public.allocate_comment_number(uuid)')::oid, 'EXECUTE') then
      raise exception 'security_audit: anon STILL has execute on allocate_comment_number(uuid)';
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2b. anon MUST keep execute on the guest write-path RPCs.
-- ---------------------------------------------------------------------------
do $$
declare
  fn text;
  -- Current signatures are link_secret-based (text first arg), not the old
  -- (uuid preview_id, ...) forms that predated the guest-link write path.
  guest_rpcs text[] := array[
    'public.create_guest_comment(text, text, text, text, text, text, jsonb, text)',
    'public.create_guest_snapshot(text, text, jsonb)'
  ];
  oid_ regprocedure;
begin
  foreach fn in array guest_rpcs loop
    oid_ := to_regprocedure(fn);
    if oid_ is null then
      raise exception 'security_audit: expected guest RPC % not found', fn;
    end if;
    if not has_function_privilege('anon', oid_::oid, 'EXECUTE') then
      raise exception 'security_audit: anon LOST execute on guest RPC %', fn;
    end if;
  end loop;
end $$;

select 'security_audit' as test, 'PASS' as result;
