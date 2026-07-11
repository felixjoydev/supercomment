-- =============================================================================
-- agent_prompt_rls.test.sql — U2 (migration 0043) member-only agent prompt
-- =============================================================================
-- pgTAP. Requires a LIVE Postgres with all migrations applied (auth.uid(),
-- review_sessions, workspace_members, etc. only exist on a real Supabase DB).
-- Fixtures use the POST-0024 workspace naming (workspaces/workspace_members) --
-- the pre-0024 `teams`/`team_members` fixtures in some older test files here are
-- stale and unrelated to this migration.
--
-- Covers:
--   * a workspace member creates the prompt; a second member of the SAME
--     workspace reads AND edits it (all-members read/write, R3); still exactly
--     one row after the edit (upsert, not append)
--   * a guest review session reads zero rows directly from the table
--   * a guest session calling set_agent_prompt is REJECTED
--   * a guest session calling get_agent_prompt gets nothing; an overlay MEMBER
--     session (review_sessions-linked) gets the prompt
--   * a member of a DIFFERENT workspace reads zero rows (tenant isolation),
--     via both the direct SELECT and get_agent_prompt
--   * overlay-path attribution stamps the REAL member (session.member_user_id),
--     never the raw anon uid
--   * deleting the parent comment cascades away the prompt row
--   * deleting the author's auth.users row set-nulls member_user_id but
--     preserves body + author_display_name
--   * direct table INSERT/UPDATE by `authenticated` is denied (no grant, and
--     RLS has no policy for either anyway)
--   * clearing (empty body) deletes the row
--   * the table carries no triggers and is not part of any realtime publication
-- =============================================================================

begin;
select plan(30);

-- --- Fixtures (as superuser) -------------------------------------------------
set local role postgres;

-- auth.users: two members of Workspace One (A, B), one member of Workspace Two
-- (C, the "outsider"), a member (E) who will be deleted later, an anonymous
-- GUEST reviewer, and an anonymous MEMBER-session reviewer (overlay, linked to A).
insert into auth.users (id, aud, role, email) values
  ('a1110000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'alice@example.com'),
  ('a2220000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'bob@example.com'),
  ('a3330000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'carol@example.com'),
  ('a6660000-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 'erin@example.com');
insert into auth.users (id, aud, role, is_anonymous) values
  ('a4440000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', true),
  ('a5550000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', true);

insert into public.workspaces (id, name) values
  ('a7770000-0000-0000-0000-000000000001', 'Workspace One'),
  ('a7770000-0000-0000-0000-000000000002', 'Workspace Two');

insert into public.workspace_members (workspace_id, user_id, role) values
  ('a7770000-0000-0000-0000-000000000001', 'a1110000-0000-0000-0000-000000000001', 'owner'),
  ('a7770000-0000-0000-0000-000000000001', 'a2220000-0000-0000-0000-000000000002', 'member'),
  ('a7770000-0000-0000-0000-000000000001', 'a6660000-0000-0000-0000-000000000006', 'member'),
  ('a7770000-0000-0000-0000-000000000002', 'a3330000-0000-0000-0000-000000000003', 'owner');

insert into public.projects (id, workspace_id, name) values
  ('a8880000-0000-0000-0000-000000000001', 'a7770000-0000-0000-0000-000000000001', 'Project One');

insert into public.previews (id, project_id, slug, access_mode, link_secret) values
  ('a9990000-0000-0000-0000-000000000001', 'a8880000-0000-0000-0000-000000000001', 'agent-prompt-preview', 'guest_link', 'ap-secret');

-- A participant to author the fixture comments (Alice, member).
insert into public.participants (id, preview_id, user_id, display_name, trust_level) values
  ('aaaa0000-0000-0000-0000-00000000000a', 'a9990000-0000-0000-0000-000000000001',
     'a1110000-0000-0000-0000-000000000001', 'Alice', 'member');

-- Four comments: X (main read/write/edit flow), W (overlay-attribution write),
-- Y (comment-delete cascade), Z (author-user-delete preserves the row).
insert into public.comments
  (id, preview_id, number, author_participant, trust_level, intent, severity, note) values
  ('ab000001-0000-0000-0000-000000000001', 'a9990000-0000-0000-0000-000000000001', 1,
     'aaaa0000-0000-0000-0000-00000000000a', 'member', 'fix', 'important', 'comment X'),
  ('ab000002-0000-0000-0000-000000000002', 'a9990000-0000-0000-0000-000000000001', 2,
     'aaaa0000-0000-0000-0000-00000000000a', 'member', 'fix', 'important', 'comment W'),
  ('ab000003-0000-0000-0000-000000000003', 'a9990000-0000-0000-0000-000000000001', 3,
     'aaaa0000-0000-0000-0000-00000000000a', 'member', 'fix', 'important', 'comment Y'),
  ('ab000004-0000-0000-0000-000000000004', 'a9990000-0000-0000-0000-000000000001', 4,
     'aaaa0000-0000-0000-0000-00000000000a', 'member', 'fix', 'important', 'comment Z');

-- A guest review session (role=guest) and an overlay MEMBER review session
-- (role=member, linked to Alice's real account) for Preview One.
insert into public.review_sessions
  (anon_user_id, preview_id, role, member_user_id, display_name, expires_at) values
  ('a4440000-0000-0000-0000-000000000004', 'a9990000-0000-0000-0000-000000000001',
     'guest', null, 'Guesty', now() + interval '8 hours'),
  ('a5550000-0000-0000-0000-000000000005', 'a9990000-0000-0000-0000-000000000001',
     'member', 'a1110000-0000-0000-0000-000000000001', 'Alice (overlay)', now() + interval '8 hours');

-- ===========================================================================
-- Sanity: the objects exist.
-- ===========================================================================
select has_table('public', 'agent_prompts', 'agent_prompts table exists');
select has_function('public', 'set_agent_prompt', array['uuid', 'text'], 'set_agent_prompt(uuid, text) exists');
select has_function('public', 'get_agent_prompt', array['uuid'], 'get_agent_prompt(uuid) exists');

-- ===========================================================================
-- Member A creates the prompt for comment X (dashboard path: no session, just
-- workspace membership).
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1110000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}';

create temporary table _created on commit drop as
  select * from public.set_agent_prompt('ab000001-0000-0000-0000-000000000001', 'Use camelCase, not snake_case.');

select is((select body from _created), 'Use camelCase, not snake_case.', 'member A creates the prompt body');
select is((select member_user_id from _created)::text, 'a1110000-0000-0000-0000-000000000001', 'attributed to member A');

-- ===========================================================================
-- Member B (SAME workspace) reads it directly, then edits it.
-- ===========================================================================
set local request.jwt.claims = '{"sub":"a2220000-0000-0000-0000-000000000002","role":"authenticated","is_anonymous":false}';

select is(
  (select body from public.agent_prompts where comment_id = 'ab000001-0000-0000-0000-000000000001'),
  'Use camelCase, not snake_case.',
  'member B (same workspace) reads the prompt directly (all-members read, R3)');

create temporary table _edited on commit drop as
  select * from public.set_agent_prompt('ab000001-0000-0000-0000-000000000001', 'Also: prefer named exports.');

select is((select body from _edited), 'Also: prefer named exports.', 'member B edits the prompt (all-members write, R3)');
select is((select member_user_id from _edited)::text, 'a2220000-0000-0000-0000-000000000002', 'edit re-attributes to member B (last-write-wins)');

select is(
  (select count(*)::int from public.agent_prompts where comment_id = 'ab000001-0000-0000-0000-000000000001'),
  1, 'exactly one row exists after the create-then-edit sequence (upsert, not append)');

-- ===========================================================================
-- Guest review session: zero rows via the direct SELECT policy.
-- ===========================================================================
set local request.jwt.claims = '{"sub":"a4440000-0000-0000-0000-000000000004","role":"authenticated","is_anonymous":true}';

select is(
  (select count(*)::int from public.agent_prompts where comment_id = 'ab000001-0000-0000-0000-000000000001'),
  0, 'a guest review session reads zero rows directly (not an error, just empty)');

-- Guest calling set_agent_prompt is REJECTED.
select throws_ok(
  $$ select public.set_agent_prompt('ab000001-0000-0000-0000-000000000001', 'malicious instruction') $$,
  'not_authorized',
  'a guest session calling set_agent_prompt is rejected');

-- Guest calling get_agent_prompt gets nothing (no exception, just empty).
select is(
  (select count(*)::int from public.get_agent_prompt('ab000001-0000-0000-0000-000000000001')),
  0, 'a guest session calling get_agent_prompt gets nothing');

-- ===========================================================================
-- Overlay MEMBER session (review_sessions-linked to Alice) gets the prompt via
-- get_agent_prompt, where the direct SELECT policy could not have served it.
-- ===========================================================================
set local request.jwt.claims = '{"sub":"a5550000-0000-0000-0000-000000000005","role":"authenticated","is_anonymous":true}';

select is(
  (select count(*)::int from public.agent_prompts where comment_id = 'ab000001-0000-0000-0000-000000000001'),
  0, 'the overlay anon session id cannot read via the direct SELECT policy (expected)');

select is(
  (select body from public.get_agent_prompt('ab000001-0000-0000-0000-000000000001')),
  'Also: prefer named exports.',
  'a member session (overlay, review_sessions-linked) gets the prompt via get_agent_prompt');

-- ===========================================================================
-- Overlay-path attribution: writing via the member-linked session stamps the
-- REAL member (session.member_user_id), never the raw anon uid.
-- ===========================================================================
create temporary table _overlay_write on commit drop as
  select * from public.set_agent_prompt('ab000002-0000-0000-0000-000000000002', 'Match the Figma spacing exactly.');

select is(
  (select member_user_id from _overlay_write)::text,
  'a1110000-0000-0000-0000-000000000001',
  'overlay-session write attributes to the REAL member, not the anon uid');
select isnt(
  (select member_user_id from _overlay_write)::text,
  'a5550000-0000-0000-0000-000000000005',
  'overlay-session write is NOT attributed to the anon session uid');
select is(
  (select author_display_name from _overlay_write),
  'Alice (overlay)',
  'overlay-session write carries the session display_name');

-- ===========================================================================
-- Member C, a DIFFERENT workspace: zero rows both ways (tenant isolation).
-- ===========================================================================
set local request.jwt.claims = '{"sub":"a3330000-0000-0000-0000-000000000003","role":"authenticated","is_anonymous":false}';

select is(
  (select count(*)::int from public.agent_prompts where comment_id = 'ab000001-0000-0000-0000-000000000001'),
  0, 'a member of a different workspace reads zero rows directly (tenant isolation)');
select is(
  (select count(*)::int from public.get_agent_prompt('ab000001-0000-0000-0000-000000000001')),
  0, 'a member of a different workspace gets nothing via get_agent_prompt (tenant isolation)');

-- ===========================================================================
-- Direct table INSERT/UPDATE by authenticated (bypassing the RPCs) is denied.
-- Post-0030, `authenticated` has NO base grant at all on a table created after
-- that migration unless explicitly granted (0030 revoked the 0001 default
-- privilege that used to auto-grant DML on future tables) -- we only granted
-- SELECT. So this is denied at the GRANT layer ("permission denied for table",
-- SQLSTATE 42501), one layer BEFORE RLS even gets evaluated -- stronger than an
-- RLS-only denial, and still proves the same thing: no write bypasses the RPCs.
-- ===========================================================================
set local request.jwt.claims = '{"sub":"a1110000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}';

-- throws_ok's every text-taking overload here matches against the exact
-- exception MESSAGE (there is no "just assert it throws, custom description"
-- overload in this pgTAP version), and pinning Postgres's own wording
-- ("permission denied for table ...") would make this needlessly brittle. So:
-- run the statement in a DO block, catch/record whether it threw via a GUC
-- (the only way to bridge a boolean out of a DO block to a following SELECT),
-- then assert with ok() and our own description.
do $$
begin
  begin
    insert into public.agent_prompts (comment_id, preview_id, body, member_user_id, author_display_name)
      values ('ab000003-0000-0000-0000-000000000003', 'a9990000-0000-0000-0000-000000000001',
              'direct insert', 'a1110000-0000-0000-0000-000000000001', 'Alice');
    perform set_config('agent_prompt_test.threw', 'false', true);
  exception when others then
    perform set_config('agent_prompt_test.threw', 'true', true);
  end;
end;
$$;
select ok(current_setting('agent_prompt_test.threw')::boolean,
  'direct INSERT by authenticated is denied (no grant, no policy)');

do $$
begin
  begin
    update public.agent_prompts set body = 'HACKED-VIA-DIRECT-UPDATE'
      where comment_id = 'ab000001-0000-0000-0000-000000000001';
    perform set_config('agent_prompt_test.threw', 'false', true);
  exception when others then
    perform set_config('agent_prompt_test.threw', 'true', true);
  end;
end;
$$;
select ok(current_setting('agent_prompt_test.threw')::boolean,
  'direct UPDATE by authenticated is denied (no grant, no policy)');

set local role postgres;
select isnt(
  (select body from public.agent_prompts where comment_id = 'ab000001-0000-0000-0000-000000000001'),
  'HACKED-VIA-DIRECT-UPDATE',
  'the direct UPDATE had no effect');

-- ===========================================================================
-- Cascade: deleting the parent comment removes the prompt row (comment Y).
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1110000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}';
select public.set_agent_prompt('ab000003-0000-0000-0000-000000000003', 'prompt on Y, about to be deleted');

set local role postgres;
delete from public.comments where id = 'ab000003-0000-0000-0000-000000000003';

select is(
  (select count(*)::int from public.agent_prompts where comment_id = 'ab000003-0000-0000-0000-000000000003'),
  0, 'deleting the parent comment cascades away the prompt row');

-- ===========================================================================
-- Deleting the AUTHOR user set-nulls member_user_id but preserves the row.
-- Erin writes via the DASHBOARD path (no review_sessions row), so
-- author_display_name is her account email -- mirroring create_review_reply's
-- member-path `coalesce(u.email, 'Member')` -- not a session display_name.
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"a6660000-0000-0000-0000-000000000006","role":"authenticated","is_anonymous":false}';
select public.set_agent_prompt('ab000004-0000-0000-0000-000000000004', 'prompt authored by Erin');

set local role postgres;
delete from auth.users where id = 'a6660000-0000-0000-0000-000000000006';

select is(
  (select member_user_id from public.agent_prompts where comment_id = 'ab000004-0000-0000-0000-000000000004'),
  null, 'deleting the author user sets member_user_id to null');
select is(
  (select body from public.agent_prompts where comment_id = 'ab000004-0000-0000-0000-000000000004'),
  'prompt authored by Erin', 'the prompt body survives the author''s deletion');
select is(
  (select author_display_name from public.agent_prompts where comment_id = 'ab000004-0000-0000-0000-000000000004'),
  'erin@example.com', 'the denormalized author_display_name (her account email, dashboard path) survives the author''s deletion');

-- ===========================================================================
-- Clear semantics: an empty body deletes the row (comment X).
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1110000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}';
select is(
  (select count(*)::int from public.set_agent_prompt('ab000001-0000-0000-0000-000000000001', '')),
  0, 'set_agent_prompt with an empty body returns zero rows (cleared)');

set local role postgres;
select is(
  (select count(*)::int from public.agent_prompts where comment_id = 'ab000001-0000-0000-0000-000000000001'),
  0, 'clearing (empty body) deletes the row entirely');

-- ===========================================================================
-- No broadcast trigger; not part of any realtime publication.
-- ===========================================================================
select is(
  (select count(*)::int from pg_trigger
     where tgrelid = 'public.agent_prompts'::regclass and not tgisinternal),
  0, 'agent_prompts has no triggers (no broadcast trigger)');
select is(
  (select count(*)::int from pg_publication_tables
     where schemaname = 'public' and tablename = 'agent_prompts'),
  0, 'agent_prompts is not part of any realtime publication');

select * from finish();
rollback;
