-- =============================================================================
-- register_deploy_target.test.sql — U13 member-only deploy-target registration
-- =============================================================================
-- pgTAP. Run against a DB with migrations applied (live Postgres + pgTAP):
--   psql "$DATABASE_URL" -f supabase/tests/register_deploy_target.test.sql
-- (Requires a live Postgres + pgTAP; NOT runnable in the JS test sandbox.)
--
-- Covers:
--   * member registers an allowlisted https deploy URL -> persisted, slug back
--   * a public custom domain is accepted and returned
--   * allowlist rejections (P0001): http, localhost, IPv4, IPv6, *.local
--   * authorization (42501): signed-in non-member, anonymous guest
-- =============================================================================

begin;
select plan(10);

-- --- Fixtures (as superuser) ------------------------------------------------
set local role postgres;

insert into auth.users (id, aud, role, email) values
  ('d1110000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'member@example.com'),
  ('d2220000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'outsider@example.com');
insert into auth.users (id, aud, role, is_anonymous) values
  ('d3330000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', true);

insert into public.teams (id, name) values
  ('daaa1111-0000-0000-0000-000000000000', 'Deploy Team');
insert into public.team_members (team_id, user_id, role) values
  ('daaa1111-0000-0000-0000-000000000000', 'd1110000-0000-0000-0000-000000000001', 'owner');
insert into public.projects (id, team_id, name) values
  ('dbbb1111-0000-0000-0000-000000000000', 'daaa1111-0000-0000-0000-000000000000', 'Deploy Proj');
insert into public.previews (id, project_id, slug, access_mode) values
  ('dccc1111-0000-0000-0000-000000000000', 'dbbb1111-0000-0000-0000-000000000000', 'deploy-slug', 'team_only');

-- ===========================================================================
-- Member registers an allowlisted https deploy URL (happy path).
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"d1110000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}';

select is(
  (select slug from public.register_deploy_target(
     'dccc1111-0000-0000-0000-000000000000', 'https://my-app.vercel.app')),
  'deploy-slug',
  'member registers an allowlisted https deploy URL and gets the slug back');

set local role postgres;
select is(
  (select deploy_url from public.previews where id = 'dccc1111-0000-0000-0000-000000000000'),
  'https://my-app.vercel.app',
  'deploy_url is persisted on the preview');

-- A public custom domain is also accepted (and the stored value is returned).
set local role authenticated;
set local request.jwt.claims = '{"sub":"d1110000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}';
select is(
  (select deploy_url from public.register_deploy_target(
     'dccc1111-0000-0000-0000-000000000000', 'https://preview.example.com')),
  'https://preview.example.com',
  'a public custom domain is accepted and returned');

-- ===========================================================================
-- Allowlist rejections (P0001). Run as the member so authz passes first.
-- ===========================================================================
select throws_ok(
  $$ select public.register_deploy_target('dccc1111-0000-0000-0000-000000000000', 'http://my-app.vercel.app') $$,
  'P0001', null, 'http scheme is rejected');

select throws_ok(
  $$ select public.register_deploy_target('dccc1111-0000-0000-0000-000000000000', 'https://localhost:3000') $$,
  'P0001', null, 'localhost is rejected');

select throws_ok(
  $$ select public.register_deploy_target('dccc1111-0000-0000-0000-000000000000', 'https://192.168.1.10') $$,
  'P0001', null, 'IPv4 literal is rejected');

select throws_ok(
  $$ select public.register_deploy_target('dccc1111-0000-0000-0000-000000000000', 'https://[::1]') $$,
  'P0001', null, 'IPv6 literal is rejected');

select throws_ok(
  $$ select public.register_deploy_target('dccc1111-0000-0000-0000-000000000000', 'https://app.local') $$,
  'P0001', null, 'a .local (mDNS) host is rejected');

-- ===========================================================================
-- Authorization (42501). A valid URL is used so the membership gate is what
-- trips (the gate runs before allowlist validation).
-- ===========================================================================
-- A signed-in non-member cannot register.
set local request.jwt.claims = '{"sub":"d2220000-0000-0000-0000-000000000002","role":"authenticated","is_anonymous":false}';
select throws_ok(
  $$ select public.register_deploy_target('dccc1111-0000-0000-0000-000000000000', 'https://my-app.vercel.app') $$,
  '42501', null, 'a signed-in non-member is not authorized');

-- An anonymous guest cannot register.
set local request.jwt.claims = '{"sub":"d3330000-0000-0000-0000-000000000003","role":"authenticated","is_anonymous":true}';
select throws_ok(
  $$ select public.register_deploy_target('dccc1111-0000-0000-0000-000000000000', 'https://my-app.vercel.app') $$,
  '42501', null, 'an anonymous guest is not authorized');

select * from finish();
rollback;
