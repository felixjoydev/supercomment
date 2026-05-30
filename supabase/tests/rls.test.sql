-- =============================================================================
-- pgTAP — multi-tenant RLS isolation + guest/anon base-table denial
-- =============================================================================
-- Run with: supabase test db   (each file runs in its own rolled-back tx).
-- Seeding is done as the postgres superuser (RLS bypassed). We then assume
-- specific identities via `set local role` + `request.jwt.claims`.
-- =============================================================================

begin;
select plan(12);

-- --- Fixtures (as superuser) ------------------------------------------------
set local role postgres;

-- auth.users rows (FKs require them to exist).
insert into auth.users (id, aud, role, email) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'authenticated', 'authenticated', 'a@example.com'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'authenticated', 'authenticated', 'b@example.com');
insert into auth.users (id, aud, role, is_anonymous) values
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'authenticated', 'authenticated', true);

insert into public.teams (id, name) values
  ('11111111-1111-1111-1111-111111111111', 'Team One'),
  ('22222222-2222-2222-2222-222222222222', 'Team Two');

insert into public.team_members (team_id, user_id, role) values
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'owner'),
  ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'owner');

insert into public.projects (id, team_id, name) values
  ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 'Proj One'),
  ('44444444-4444-4444-4444-444444444444', '22222222-2222-2222-2222-222222222222', 'Proj Two');

insert into public.previews (id, project_id, slug, access_mode, link_secret) values
  ('55555555-5555-5555-5555-555555555555', '33333333-3333-3333-3333-333333333333', 'team-one-preview', 'guest_link', 'rls-secret-1'),
  ('66666666-6666-6666-6666-666666666666', '44444444-4444-4444-4444-444444444444', 'team-two-preview', 'team_only',  'rls-secret-2');

insert into public.participants (id, preview_id, user_id, display_name, trust_level) values
  ('77777777-7777-7777-7777-777777777777', '55555555-5555-5555-5555-555555555555', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Alice', 'member'),
  ('88888888-8888-8888-8888-888888888888', '66666666-6666-6666-6666-666666666666', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Bob',   'member');

insert into public.comments (id, preview_id, number, author_participant, trust_level, intent, severity, note) values
  ('99999999-9999-9999-9999-999999999999', '55555555-5555-5555-5555-555555555555', 1, '77777777-7777-7777-7777-777777777777', 'member', 'fix', 'important', 'team one comment'),
  ('aaaa0000-0000-0000-0000-000000000000', '66666666-6666-6666-6666-666666666666', 1, '88888888-8888-8888-8888-888888888888', 'member', 'fix', 'important', 'team two comment');

insert into public.snapshots (preview_id, path) values
  ('55555555-5555-5555-5555-555555555555', '/'),
  ('66666666-6666-6666-6666-666666666666', '/');

-- ===========================================================================
-- Member A (Team One) — can read own team, blocked cross-team.
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated","is_anonymous":false}';

select is(
  (select count(*)::int from public.comments where preview_id = '55555555-5555-5555-5555-555555555555'),
  1, 'member A reads own team comments');

select is(
  (select count(*)::int from public.comments where preview_id = '66666666-6666-6666-6666-666666666666'),
  0, 'member A cannot read another team comments (RLS)');

select is(
  (select count(*)::int from public.snapshots where preview_id = '66666666-6666-6666-6666-666666666666'),
  0, 'member A cannot read another team snapshots (RLS)');

select is(
  (select count(*)::int from public.previews where id = '66666666-6666-6666-6666-666666666666'),
  0, 'member A cannot read another team preview (RLS)');

select is(
  (select count(*)::int from public.projects where team_id = '22222222-2222-2222-2222-222222222222'),
  0, 'member A cannot read another team project (RLS)');

select lives_ok(
  $$ update public.comments set status = 'resolved'
     where id = '99999999-9999-9999-9999-999999999999' $$,
  'member A can update own team comment');

-- direct comment INSERT is denied even for a member (numbering goes through RPC)
select throws_ok(
  $$ insert into public.comments (preview_id, number, author_participant, trust_level, intent, severity, note)
     values ('55555555-5555-5555-5555-555555555555', 999, '77777777-7777-7777-7777-777777777777', 'member', 'fix', 'minor', 'direct insert') $$);

-- ===========================================================================
-- Guest (anonymous, authenticated role, not a team member) — no base-table DML.
-- ===========================================================================
set local request.jwt.claims = '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","role":"authenticated","is_anonymous":true}';

select is(
  (select count(*)::int from public.comments),
  0, 'guest cannot SELECT comments directly (RLS)');

-- guest cannot INSERT comments directly (RLS)
select throws_ok(
  $$ insert into public.comments (preview_id, number, author_participant, trust_level, intent, severity, note)
     values ('55555555-5555-5555-5555-555555555555', 1000, '77777777-7777-7777-7777-777777777777', 'guest', 'fix', 'minor', 'guest direct') $$);

-- guest cannot INSERT participants directly (RLS)
select throws_ok(
  $$ insert into public.participants (preview_id, user_id, display_name, trust_level)
     values ('55555555-5555-5555-5555-555555555555', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'Hacker', 'guest') $$);

-- ===========================================================================
-- Raw anon role (no session at all).
-- ===========================================================================
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

select is(
  (select count(*)::int from public.comments),
  0, 'anon role cannot SELECT comments (RLS)');

-- anon role cannot INSERT comments (RLS)
select throws_ok(
  $$ insert into public.comments (preview_id, number, author_participant, trust_level, intent, severity, note)
     values ('55555555-5555-5555-5555-555555555555', 1001, '77777777-7777-7777-7777-777777777777', 'guest', 'fix', 'minor', 'anon direct') $$);

select * from finish();
rollback;
