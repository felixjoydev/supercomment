-- =============================================================================
-- review_comment_caps.test.sql — U4 guest write-path caps (migration 0020)
-- =============================================================================
-- pgTAP. NEEDS A LIVE DB: run against a Postgres with pgTAP + ALL migrations
-- (through 0020) applied. NOT runnable in the JS test sandbox.
--   psql "$DATABASE_URL" -f supabase/tests/review_comment_caps.test.sql
--
-- Covers (0020 layered on 0019, signature unchanged):
--   * create_review_comment(uuid,text,text,text,jsonb,text) still exists
--   * a normal guest comment still succeeds (no regression) — number 1
--   * payload guard: pg_column_size(p_context) > 3 MiB -> 'payload_too_large'
--   * rate limit: the 21st guest comment in a 60s window -> 'rate_limited'
--   * members are EXEMPT from the rate limit (25 member comments all succeed)
-- =============================================================================

begin;
select plan(5);

-- --- Fixtures (as superuser) ------------------------------------------------
set local role postgres;

-- Two anonymous reviewers (guest path) + one real member account.
insert into auth.users (id, aud, role, is_anonymous) values
  ('ca110000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', true),  -- guest anon
  ('ca110000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', true);  -- member's anon
insert into auth.users (id, aud, role, email, is_anonymous) values
  ('ca110000-0000-0000-0000-0000000000aa', 'authenticated', 'authenticated', 'cap-member@example.com', false);

insert into public.teams (id, name) values
  ('caaa1111-0000-0000-0000-000000000000', 'Caps Team');
insert into public.team_members (team_id, user_id, role) values
  ('caaa1111-0000-0000-0000-000000000000', 'ca110000-0000-0000-0000-0000000000aa', 'owner');
insert into public.projects (id, team_id, name) values
  ('cbbb1111-0000-0000-0000-000000000000', 'caaa1111-0000-0000-0000-000000000000', 'Caps Proj');

-- Two previews: one for the guest caps, one for the member-exempt check.
insert into public.previews (id, project_id, slug, access_mode) values
  ('ccaa1111-0000-0000-0000-000000000000', 'cbbb1111-0000-0000-0000-000000000000', 'caps-guest',  'guest_link'),
  ('ccaa2222-0000-0000-0000-000000000000', 'cbbb1111-0000-0000-0000-000000000000', 'caps-member', 'team_only');

-- Review sessions (insert directly; the exchange/establish path is tested elsewhere).
insert into public.review_sessions
  (anon_user_id, preview_id, role, member_user_id, display_name, expires_at) values
  ('ca110000-0000-0000-0000-000000000001', 'ccaa1111-0000-0000-0000-000000000000',
   'guest', null, 'Cap Guest', now() + interval '8 hours'),
  ('ca110000-0000-0000-0000-000000000002', 'ccaa2222-0000-0000-0000-000000000000',
   'member', 'ca110000-0000-0000-0000-0000000000aa', 'Cap Member', now() + interval '8 hours');

-- ===========================================================================
-- The function exists with the exact 0019/0020 signature (no overload created).
-- ===========================================================================
select has_function(
  'public', 'create_review_comment',
  array['uuid', 'text', 'text', 'text', 'jsonb', 'text'],
  'create_review_comment(uuid,text,text,text,jsonb,text) exists'
);

-- ===========================================================================
-- Guest happy path still works (no regression from the added caps): #1.
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"ca110000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":true}';

select is(
  (select number from public.create_review_comment(
     'ccaa1111-0000-0000-0000-000000000000', 'fix', 'minor', 'first', '{}'::jsonb)),
  1,
  'guest comment still succeeds and is numbered 1 (caps do not regress the happy path)');

-- ===========================================================================
-- Payload guard: a >3 MiB context is rejected server-side. The jsonb arg is an
-- in-memory datum, so pg_column_size measures its uncompressed size (~4 MiB).
-- ===========================================================================
select throws_ok(
  $$ select public.create_review_comment(
       'ccaa1111-0000-0000-0000-000000000000', 'fix', 'minor', 'too big',
       jsonb_build_object('blob', repeat('x', 4 * 1024 * 1024)), 'live') $$,
  'P0001', 'payload_too_large',
  'oversized context (>3 MiB) is rejected with payload_too_large');

-- ===========================================================================
-- Rate limit: 20 guest comments per rolling 60s window; the 21st is rejected.
-- One comment already exists (#1 above); add 19 more to fill the window to 20,
-- then expect the next call to raise 'rate_limited'. now() is the (fixed)
-- transaction time, so all comments fall inside the 60s window.
-- ===========================================================================
do $$
begin
  for i in 1..19 loop
    perform public.create_review_comment(
      'ccaa1111-0000-0000-0000-000000000000', 'fix', 'minor', 'flood', '{}'::jsonb);
  end loop;
end
$$;

select throws_ok(
  $$ select public.create_review_comment(
       'ccaa1111-0000-0000-0000-000000000000', 'fix', 'minor', 'over the cap', '{}'::jsonb) $$,
  'P0001', 'rate_limited',
  'the 21st guest comment within 60s is rejected with rate_limited');

-- ===========================================================================
-- Members are EXEMPT: 25 member comments in the same window all succeed.
-- (If the cap applied, the 21st would raise inside the DO block and fail here.)
-- ===========================================================================
set local request.jwt.claims = '{"sub":"ca110000-0000-0000-0000-000000000002","role":"authenticated","is_anonymous":true}';
do $$
begin
  for i in 1..25 loop
    perform public.create_review_comment(
      'ccaa2222-0000-0000-0000-000000000000', 'fix', 'minor', 'member many', '{}'::jsonb);
  end loop;
end
$$;

set local role postgres;
select is(
  (select count(*)::int from public.comments
     where preview_id = 'ccaa2222-0000-0000-0000-000000000000'),
  25,
  'members are exempt from the rate limit (25 member comments all persisted)');

select * from finish();
rollback;
