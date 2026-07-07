-- =============================================================================
-- send_comment_to_agent.test.sql — U3 (migration 0044) one send RPC for both
-- surfaces: marker, snapshot, guest-confirm gate.
-- =============================================================================
-- pgTAP. Requires a LIVE Postgres with all migrations applied (auth.uid(),
-- review_sessions, workspace_members, agent_prompts, etc. only exist on a real
-- Supabase DB). Fixtures use the POST-0024 workspace naming
-- (workspaces/workspace_members), mirroring agent_prompt_rls.test.sql (U2).
--
-- Covers:
--   * happy path: a confirmed GUEST-authored comment send inserts a queue row,
--     sets the confirm marker, and writes a snapshot equal to the live prompt
--   * dedup: re-sending while the row is still pending/working is a no-op
--     insert (same queue row); the snapshot is NOT overwritten (first-wins)
--     even if the live prompt changed in between
--   * after the prior row reaches a terminal status (done), a fresh send DOES
--     write a NEW row with a NEW snapshot reflecting the current prompt
--   * a member-authored comment sends with p_confirm_guest omitted and writes
--     NO marker row at all
--   * two sequential member sends of the SAME comment yield exactly one active
--     queue row (dedup on the member path too)
--   * an unconfirmed guest send is REJECTED (guest_confirm_required /
--     SQLSTATE P0002) — no queue row, no marker
--   * a guest SESSION (not a guest-authored comment) calling the RPC at all is
--     rejected regardless of whose comment it is (not_authorized / 42501)
--   * a member without can_send_to_agent granted is rejected
--     (send_to_agent_forbidden / 42501)
--   * the overlay's anon-linked MEMBER session resolves to the REAL member
--     (never the raw anon session uid) for both requested_by and marker
--     attribution
--   * table/function existence, grants, and RLS shape sanity checks
-- =============================================================================

begin;
select plan(35);

-- --- Fixtures (as superuser) -------------------------------------------------
set local role postgres;

-- auth.users: Alice (owner, can_send_to_agent), Bob (member, can_send_to_agent),
-- Carol (member, NOT granted), a guest reviewer session, and Bob's overlay
-- MEMBER session (anon, linked to Bob).
insert into auth.users (id, aud, role, email) values
  ('c1110000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'alice-s3@example.com'),
  ('c2220000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'bob-s3@example.com'),
  ('c3330000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'carol-s3@example.com');
insert into auth.users (id, aud, role, is_anonymous) values
  ('c4440000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', true),
  ('c5550000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', true);

insert into public.workspaces (id, name) values
  ('c7770000-0000-0000-0000-000000000001', 'Send RPC Test Workspace');

insert into public.workspace_members (workspace_id, user_id, role, can_send_to_agent) values
  ('c7770000-0000-0000-0000-000000000001', 'c1110000-0000-0000-0000-000000000001', 'owner', true),
  ('c7770000-0000-0000-0000-000000000001', 'c2220000-0000-0000-0000-000000000002', 'member', true),
  ('c7770000-0000-0000-0000-000000000001', 'c3330000-0000-0000-0000-000000000003', 'member', false);

insert into public.projects (id, workspace_id, name) values
  ('c8880000-0000-0000-0000-000000000001', 'c7770000-0000-0000-0000-000000000001', 'Send RPC Test Project');

insert into public.previews (id, project_id, slug, access_mode, link_secret) values
  ('c9990000-0000-0000-0000-000000000001', 'c8880000-0000-0000-0000-000000000001', 'send-rpc-test-preview', 'guest_link', 'send-rpc-secret');

insert into public.participants (id, preview_id, user_id, display_name, trust_level) values
  ('caaa0000-0000-0000-0000-00000000000a', 'c9990000-0000-0000-0000-000000000001',
     'c1110000-0000-0000-0000-000000000001', 'Alice', 'member'),
  ('caaa0000-0000-0000-0000-00000000000b', 'c9990000-0000-0000-0000-000000000001',
     null, 'Gary Guest', 'guest');

-- Comments: G1 guest-authored (happy path / dedup / terminal-then-fresh), M1
-- member-authored (member send / two-sends dedup), G2 guest-authored
-- (unconfirmed rejection), M2 member-authored (overlay session attribution).
insert into public.comments
  (id, preview_id, number, author_participant, trust_level, intent, severity, note) values
  ('cb000001-0000-0000-0000-000000000001', 'c9990000-0000-0000-0000-000000000001', 1,
     'caaa0000-0000-0000-0000-00000000000b', 'guest', 'fix', 'important', 'G1 guest comment'),
  ('cb000002-0000-0000-0000-000000000002', 'c9990000-0000-0000-0000-000000000001', 2,
     'caaa0000-0000-0000-0000-00000000000a', 'member', 'fix', 'important', 'M1 member comment'),
  ('cb000003-0000-0000-0000-000000000003', 'c9990000-0000-0000-0000-000000000001', 3,
     'caaa0000-0000-0000-0000-00000000000b', 'guest', 'fix', 'important', 'G2 guest comment'),
  ('cb000004-0000-0000-0000-000000000004', 'c9990000-0000-0000-0000-000000000001', 4,
     'caaa0000-0000-0000-0000-00000000000a', 'member', 'fix', 'important', 'M2 member comment (overlay)');

-- The live prompt for G1 (member-authored trusted instruction, U2).
insert into public.agent_prompts (comment_id, preview_id, body, member_user_id, author_display_name) values
  ('cb000001-0000-0000-0000-000000000001', 'c9990000-0000-0000-0000-000000000001',
   'Original prompt: check the guest reference image against the live page.',
   'c1110000-0000-0000-0000-000000000001', 'Alice');

-- A guest review session and Bob's overlay MEMBER review session.
insert into public.review_sessions
  (anon_user_id, preview_id, role, member_user_id, display_name, expires_at) values
  ('c4440000-0000-0000-0000-000000000004', 'c9990000-0000-0000-0000-000000000001',
     'guest', null, 'Gary Guest (overlay)', now() + interval '8 hours'),
  ('c5550000-0000-0000-0000-000000000005', 'c9990000-0000-0000-0000-000000000001',
     'member', 'c2220000-0000-0000-0000-000000000002', 'Bob (overlay)', now() + interval '8 hours');

-- ===========================================================================
-- Sanity: the objects exist.
-- ===========================================================================
select has_table('public', 'agent_reference_confirmations', 'agent_reference_confirmations table exists');
select has_function('public', 'send_comment_to_agent', array['uuid', 'boolean'], 'send_comment_to_agent(uuid, boolean) exists');
select has_column('public', 'comment_queue', 'prompt_snapshot', 'comment_queue.prompt_snapshot exists');
select has_column('public', 'comment_queue', 'prompt_snapshot_author', 'comment_queue.prompt_snapshot_author exists');
select has_column('public', 'comment_queue', 'prompt_snapshot_at', 'comment_queue.prompt_snapshot_at exists');

-- ===========================================================================
-- Happy path: Alice (dashboard, no session) confirms a GUEST-authored send.
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"c1110000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}';

create temporary table _t1 on commit drop as
  select * from public.send_comment_to_agent('cb000001-0000-0000-0000-000000000001', true);

select is((select count(*)::int from _t1), 1, 'confirmed guest send returns exactly one row');
select is((select status from _t1), 'pending', 'the returned row is pending');
select is(
  (select prompt_snapshot from _t1),
  'Original prompt: check the guest reference image against the live page.',
  'the snapshot equals the live prompt at send time');
select is((select prompt_snapshot_author from _t1), 'Alice', 'the snapshot author matches the prompt author');
select is((select requested_by::text from _t1), 'c1110000-0000-0000-0000-000000000001', 'requested_by is Alice');

set local role postgres;
select is(
  (select count(*)::int from public.agent_reference_confirmations where comment_id = 'cb000001-0000-0000-0000-000000000001'),
  1, 'a confirm marker row now exists for the guest-authored comment');
select is(
  (select confirmed_by::text from public.agent_reference_confirmations where comment_id = 'cb000001-0000-0000-0000-000000000001'),
  'c1110000-0000-0000-0000-000000000001', 'the marker is attributed to Alice');

-- ===========================================================================
-- Dedup: change the live prompt, then re-send while the row is still active.
-- The existing row is returned untouched; the snapshot is NOT overwritten.
-- ===========================================================================
set local role postgres;
update public.agent_prompts set body = 'CHANGED after first send' where comment_id = 'cb000001-0000-0000-0000-000000000001';

set local role authenticated;
set local request.jwt.claims = '{"sub":"c1110000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}';

create temporary table _t2 on commit drop as
  select * from public.send_comment_to_agent('cb000001-0000-0000-0000-000000000001', true);

set local role postgres;
select is(
  (select count(*)::int from public.comment_queue where comment_id = 'cb000001-0000-0000-0000-000000000001'),
  1, 'still exactly one comment_queue row for G1 right after the dedup call');
select is((select id from _t1)::text, (select id from _t2)::text, 'the dedup call returns the SAME queue row id');
select is(
  (select prompt_snapshot from _t2),
  'Original prompt: check the guest reference image against the live page.',
  'the snapshot is NOT overwritten by the dedup call (first-wins)');

-- ===========================================================================
-- After the prior row reaches a terminal status, a fresh send DOES write a
-- new row with a NEW snapshot reflecting the current (changed) prompt.
-- ===========================================================================
set local role postgres;
update public.comment_queue set status = 'done' where comment_id = 'cb000001-0000-0000-0000-000000000001';

set local role authenticated;
set local request.jwt.claims = '{"sub":"c1110000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}';

create temporary table _t3 on commit drop as
  select * from public.send_comment_to_agent('cb000001-0000-0000-0000-000000000001', true);

select isnt((select id from _t3)::text, (select id from _t1)::text, 'the fresh send after a terminal status is a NEW row');
select is((select prompt_snapshot from _t3), 'CHANGED after first send', 'the new row snapshots the CURRENT prompt');

set local role postgres;
select is(
  (select count(*)::int from public.comment_queue where comment_id = 'cb000001-0000-0000-0000-000000000001'),
  2, 'two comment_queue rows now exist total for G1 (one done, one pending)');

-- ===========================================================================
-- Member-authored comment: sends with p_confirm_guest omitted and writes NO
-- marker row at all (member rasters resolve regardless, per later units).
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"c1110000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}';

create temporary table _t4 on commit drop as
  select * from public.send_comment_to_agent('cb000002-0000-0000-0000-000000000002');

select is((select count(*)::int from _t4), 1, 'member-authored send succeeds with confirm omitted');
select is((select status from _t4), 'pending', 'the member-authored row is pending');

set local role postgres;
select is(
  (select count(*)::int from public.agent_reference_confirmations where comment_id = 'cb000002-0000-0000-0000-000000000002'),
  0, 'NO marker row is written for a member-authored send');

-- ===========================================================================
-- Two sequential member sends of the SAME comment yield exactly one active
-- queue row (dedup on the member path too — the concurrent-send scenario).
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"c1110000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}';
select public.send_comment_to_agent('cb000002-0000-0000-0000-000000000002');

set local role postgres;
select is(
  (select count(*)::int from public.comment_queue
     where comment_id = 'cb000002-0000-0000-0000-000000000002' and status in ('pending', 'working')),
  1, 'exactly one active row exists for M1 after two sequential member sends');

-- ===========================================================================
-- Error path: an unconfirmed guest send is REJECTED (guest_confirm_required,
-- SQLSTATE P0002) — no queue row, no marker.
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"c1110000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}';

select throws_ok(
  $$ select public.send_comment_to_agent('cb000003-0000-0000-0000-000000000003', false) $$,
  'P0002', 'guest_confirm_required',
  'an unconfirmed guest-authored send is rejected with guest_confirm_required (P0002)');

select throws_ok(
  $$ select public.send_comment_to_agent('cb000003-0000-0000-0000-000000000003') $$,
  'P0002', 'guest_confirm_required',
  'p_confirm_guest omitted entirely (defaults false) is also rejected');

set local role postgres;
select is(
  (select count(*)::int from public.comment_queue where comment_id = 'cb000003-0000-0000-0000-000000000003'),
  0, 'no queue row was written for the rejected guest send');
select is(
  (select count(*)::int from public.agent_reference_confirmations where comment_id = 'cb000003-0000-0000-0000-000000000003'),
  0, 'no marker row was written for the rejected guest send');

-- ===========================================================================
-- Error path: a GUEST session (not a guest-authored comment) calling the RPC
-- at all is rejected — guests can never send, regardless of whose comment.
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"c4440000-0000-0000-0000-000000000004","role":"authenticated","is_anonymous":true}';

select throws_ok(
  $$ select public.send_comment_to_agent('cb000002-0000-0000-0000-000000000002', true) $$,
  'not_authorized',
  'a guest review session calling send_comment_to_agent is rejected outright');

-- ===========================================================================
-- Error path: a member WITHOUT can_send_to_agent granted is rejected.
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"c3330000-0000-0000-0000-000000000003","role":"authenticated","is_anonymous":false}';

select throws_ok(
  $$ select public.send_comment_to_agent('cb000004-0000-0000-0000-000000000004', true) $$,
  'send_to_agent_forbidden',
  'a member without can_send_to_agent granted is rejected');

set local role postgres;
select is(
  (select count(*)::int from public.comment_queue where comment_id = 'cb000004-0000-0000-0000-000000000004'),
  0, 'no queue row was written by the unpermitted member''s rejected attempt');

-- ===========================================================================
-- Overlay MEMBER session (Bob, review_sessions-linked): the resolved identity
-- is the REAL member, never the raw anon session uid.
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"c5550000-0000-0000-0000-000000000005","role":"authenticated","is_anonymous":true}';

create temporary table _t9 on commit drop as
  select * from public.send_comment_to_agent('cb000004-0000-0000-0000-000000000004', true);

select is((select count(*)::int from _t9), 1, 'the overlay member session send succeeds');
select is(
  (select requested_by::text from _t9),
  'c2220000-0000-0000-0000-000000000002',
  'requested_by is attributed to Bob, the REAL member');
select isnt(
  (select requested_by::text from _t9),
  'c5550000-0000-0000-0000-000000000005',
  'requested_by is NOT the raw anon session uid');

-- ===========================================================================
-- Direct table writes to agent_reference_confirmations by `authenticated` are
-- denied (no grant, no write policy) — all writes go only through the RPC.
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"c1110000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}';
do $$
begin
  begin
    insert into public.agent_reference_confirmations (comment_id, preview_id, confirmed_by)
      values ('cb000003-0000-0000-0000-000000000003', 'c9990000-0000-0000-0000-000000000001',
              'c1110000-0000-0000-0000-000000000001');
    perform set_config('send_rpc_test.threw', 'false', true);
  exception when others then
    perform set_config('send_rpc_test.threw', 'true', true);
  end;
end;
$$;
select ok(current_setting('send_rpc_test.threw')::boolean,
  'direct INSERT into agent_reference_confirmations by authenticated is denied');

-- ===========================================================================
-- No triggers; not part of any realtime publication (mirrors agent_prompts).
-- ===========================================================================
set local role postgres;
select is(
  (select count(*)::int from pg_trigger
     where tgrelid = 'public.agent_reference_confirmations'::regclass and not tgisinternal),
  0, 'agent_reference_confirmations has no triggers (no broadcast trigger)');
select is(
  (select count(*)::int from pg_publication_tables
     where schemaname = 'public' and tablename = 'agent_reference_confirmations'),
  0, 'agent_reference_confirmations is not part of any realtime publication');

select * from finish();
rollback;
