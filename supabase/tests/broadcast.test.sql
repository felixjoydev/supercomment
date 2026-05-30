-- =============================================================================
-- pgTAP — realtime Broadcast-from-DB on comment insert/resolve (AE6)
-- =============================================================================
-- Asserts that a comment INSERT and a subsequent resolve (UPDATE) each emit a
-- broadcast row into realtime.messages for the preview's private topic.
--
-- NOTE: this test requires a full Supabase realtime environment (the
-- realtime.messages table + broadcast_changes), which `supabase db reset`
-- provisions. The broadcast trigger itself is best-effort (it never blocks the
-- write), so this test verifies the message rows directly rather than via the
-- trigger's success. Counts are read as the superuser to bypass the
-- realtime.messages RLS policy.
-- =============================================================================

begin;
select plan(2);

-- --- Fixtures (as superuser) ------------------------------------------------
set local role postgres;

insert into auth.users (id, aud, role, email) values
  ('dddd0000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'bcmember@example.com');
insert into auth.users (id, aud, role, is_anonymous) values
  ('eeee0000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', true);

insert into public.teams (id, name) values
  ('aaaabbbb-0000-0000-0000-000000000000', 'BC Team');
insert into public.team_members (team_id, user_id, role) values
  ('aaaabbbb-0000-0000-0000-000000000000', 'dddd0000-0000-0000-0000-000000000001', 'owner');
insert into public.projects (id, team_id, name) values
  ('bbbbcccc-0000-0000-0000-000000000000', 'aaaabbbb-0000-0000-0000-000000000000', 'BC Proj');
insert into public.previews (id, project_id, slug, access_mode, link_secret) values
  ('ccccdddd-0000-0000-0000-000000000000', 'bbbbcccc-0000-0000-0000-000000000000', 'bc-preview', 'guest_link', 'bc-secret');

-- --- Guest creates a comment (fires the INSERT broadcast). ------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"eeee0000-0000-0000-0000-000000000002","role":"authenticated","is_anonymous":true}';
select public.create_guest_comment('bc-secret', '/p', 'Zed', 'fix', 'important', 'note', '{}'::jsonb);

set local role postgres;
select cmp_ok(
  (select count(*)::int from realtime.messages
     where topic = 'preview:ccccdddd-0000-0000-0000-000000000000'),
  '>=', 1, 'AE6: comment INSERT emits a broadcast on the preview topic');

-- --- Member resolves it (fires the UPDATE broadcast). ----------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"dddd0000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}';
select public.resolve_comment(
  (select c.id from public.comments c
     where c.preview_id = 'ccccdddd-0000-0000-0000-000000000000' and c.number = 1),
  'done');

set local role postgres;
select cmp_ok(
  (select count(*)::int from realtime.messages
     where topic = 'preview:ccccdddd-0000-0000-0000-000000000000'),
  '>=', 2, 'AE6: resolve (UPDATE) emits a second broadcast on the preview topic');

select * from finish();
rollback;
