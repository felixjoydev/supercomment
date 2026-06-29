-- =============================================================================
-- list_review_comments.test.sql — U12 (migration 0022)
-- =============================================================================
-- pgTAP. Requires a LIVE Postgres + pgTAP with all migrations applied (the auth
-- schema, auth.uid(), review_sessions, etc. only exist on a real Supabase DB):
--   psql "$DATABASE_URL" -f supabase/tests/list_review_comments.test.sql
-- NOT runnable in the JS test sandbox.
--
-- Covers:
--   * the RPC exists
--   * an activated session lists ITS preview's comments (count + ordering +
--     joined display_name + is_stale passthrough)
--   * scope: only the session's preview is returned (no cross-preview leak)
--   * a session for preview A cannot read preview B (no_review_session)
--   * no session at all -> no_review_session
-- =============================================================================

begin;
select plan(7);

-- --- Fixtures (as superuser) ------------------------------------------------
set local role postgres;

-- A team member (attributes nothing here) + the anonymous guest reviewer + a
-- stranger with no session.
insert into auth.users (id, aud, role, email) values
  ('e1110000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'member@example.com');
insert into auth.users (id, aud, role, is_anonymous) values
  ('e3330000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', true),
  ('e4440000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', true);

insert into public.teams (id, name) values
  ('eaaa1111-0000-0000-0000-000000000000', 'List Team');
insert into public.team_members (team_id, user_id, role) values
  ('eaaa1111-0000-0000-0000-000000000000', 'e1110000-0000-0000-0000-000000000001', 'owner');
insert into public.projects (id, team_id, name) values
  ('ebbb1111-0000-0000-0000-000000000000', 'eaaa1111-0000-0000-0000-000000000000', 'List Proj');

-- Preview A (the session's preview) and preview B (a different preview).
insert into public.previews (id, project_id, slug, access_mode) values
  ('ecccaaaa-0000-0000-0000-00000000000a', 'ebbb1111-0000-0000-0000-000000000000', 'preview-a', 'guest_link'),
  ('ecccbbbb-0000-0000-0000-00000000000b', 'ebbb1111-0000-0000-0000-000000000000', 'preview-b', 'guest_link');

-- Participants: the guest on A, and an author on B.
insert into public.participants (id, preview_id, user_id, display_name, trust_level) values
  ('ed000001-0000-0000-0000-000000000001', 'ecccaaaa-0000-0000-0000-00000000000a',
     'e3330000-0000-0000-0000-000000000003', 'Guesty', 'guest'),
  ('ed000002-0000-0000-0000-000000000002', 'ecccbbbb-0000-0000-0000-00000000000b',
     'e1110000-0000-0000-0000-000000000001', 'Member B', 'member');

-- Two comments on A (one stale), one comment on B.
insert into public.comments
  (preview_id, number, author_participant, trust_level, intent, severity, note, is_stale) values
  ('ecccaaaa-0000-0000-0000-00000000000a', 1, 'ed000001-0000-0000-0000-000000000001',
     'guest', 'fix', 'important', 'first on A', false),
  ('ecccaaaa-0000-0000-0000-00000000000a', 2, 'ed000001-0000-0000-0000-000000000001',
     'guest', 'change', 'minor', 'second on A', true),
  ('ecccbbbb-0000-0000-0000-00000000000b', 1, 'ed000002-0000-0000-0000-000000000002',
     'member', 'question', 'minor', 'on B', false);

-- An unexpired review session for the guest, scoped to preview A only.
insert into public.review_sessions
  (anon_user_id, preview_id, role, display_name, expires_at) values
  ('e3330000-0000-0000-0000-000000000003', 'ecccaaaa-0000-0000-0000-00000000000a',
     'guest', 'Guesty', now() + interval '8 hours');

-- ===========================================================================
-- The RPC exists.
-- ===========================================================================
select has_function(
  'public', 'list_review_comments', array['uuid'],
  'list_review_comments(uuid) exists'
);

-- ===========================================================================
-- As the guest (anon JWT, session scoped to preview A).
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"e3330000-0000-0000-0000-000000000003","role":"authenticated","is_anonymous":true}';

-- Lists exactly A's two comments.
select is(
  (select count(*)::int from public.list_review_comments('ecccaaaa-0000-0000-0000-00000000000a')),
  2,
  'an activated session lists its preview''s comments (both of A)');

-- Scope: none of B's comments leak into A's listing.
select is(
  (select count(*)::int from public.list_review_comments('ecccaaaa-0000-0000-0000-00000000000a')
     where note = 'on B'),
  0,
  'the listing is scoped to the session preview (no cross-preview rows)');

-- Ordering + joined display_name: first row is number 1, authored by Guesty.
select is(
  (select display_name from public.list_review_comments('ecccaaaa-0000-0000-0000-00000000000a')
     order by number limit 1),
  'Guesty',
  'rows are ordered by number and carry the joined author display_name');

-- is_stale passes through for the stale comment (number 2).
select is(
  (select is_stale from public.list_review_comments('ecccaaaa-0000-0000-0000-00000000000a')
     where number = 2),
  true,
  'is_stale is returned per comment');

-- Cross-preview read is refused: the guest has no session for B.
select throws_ok(
  $$ select public.list_review_comments('ecccbbbb-0000-0000-0000-00000000000b') $$,
  'no_review_session',
  'a session for preview A cannot read preview B');

-- ===========================================================================
-- A different anon user with NO session at all is refused.
-- ===========================================================================
set local request.jwt.claims = '{"sub":"e4440000-0000-0000-0000-000000000004","role":"authenticated","is_anonymous":true}';
select throws_ok(
  $$ select public.list_review_comments('ecccaaaa-0000-0000-0000-00000000000a') $$,
  'no_review_session',
  'no review session -> no_review_session');

select * from finish();
rollback;
