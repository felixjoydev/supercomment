-- security_audit.sql
-- U13 security audit. Asserts the cross-cutting database controls hold:
--   1. RLS is ENABLED on every public table.
--   2. anon LACKS direct execute on the internal SECURITY DEFINER helpers
--      (tightened in 0008) but RETAINS execute on the guest write-path RPCs
--      it legitimately needs.
-- Each failing assert RAISES, aborting with a non-zero result. Run via:
--   psql ... -f supabase/tests/security_audit.sql   (or MCP execute_sql)

-- ---------------------------------------------------------------------------
-- 1. RLS enabled on all 8 public tables.
-- ---------------------------------------------------------------------------
do $$
declare
  tbl text;
  tables text[] := array[
    'teams', 'team_members', 'projects', 'previews',
    'participants', 'comments', 'snapshots', 'comment_queue'
  ];
  has_rls boolean;
begin
  foreach tbl in array tables loop
    select c.relrowsecurity
      into has_rls
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = tbl;

    if has_rls is null then
      raise exception 'security_audit: table public.% does not exist', tbl;
    end if;
    if has_rls is not true then
      raise exception 'security_audit: RLS is NOT enabled on public.%', tbl;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2a. anon must NOT have execute on the internal RLS helpers.
-- ---------------------------------------------------------------------------
do $$
declare
  fn text;
  internal_helpers text[] := array[
    'public.is_team_member(uuid)',
    'public.is_project_team_member(uuid)',
    'public.is_preview_team_member(uuid)',
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

  -- Guard-wrapped (may be present): is_team_admin / allocate_comment_number.
  if to_regprocedure('public.is_team_admin(uuid)') is not null then
    if has_function_privilege('anon', to_regprocedure('public.is_team_admin(uuid)')::oid, 'EXECUTE') then
      raise exception 'security_audit: anon STILL has execute on is_team_admin(uuid)';
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
  guest_rpcs text[] := array[
    'public.create_guest_comment(uuid, text, text, text, jsonb, text)',
    'public.create_guest_snapshot(uuid, text, jsonb)'
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
