-- =============================================================================
-- register_preview_tunnel_validation.test.sql — U10 tunnel-URL allowlist (R17)
-- =============================================================================
-- pgTAP. Run against a DB with migrations applied (live Postgres + pgTAP):
--   psql "$DATABASE_URL" -f supabase/tests/register_preview_tunnel_validation.test.sql
-- (Requires a live Postgres + pgTAP; NOT runnable in the JS test sandbox.)
--
-- Covers 0023's SSRF-guard allowlist on register_preview_tunnel:
--   * member registers a valid *.trycloudflare.com https URL -> persisted, slug
--   * localhost is accepted (dev)
--   * rejections (P0001): http scheme, evil host, suffix-spoof host, IP literal,
--     embedded credentials
--   * authorization still gates first (42501) for a signed-in non-member
-- =============================================================================

begin;
select plan(10);

-- --- Fixtures (as superuser) ------------------------------------------------
set local role postgres;

insert into auth.users (id, aud, role, email) values
  ('f1110000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'member@example.com'),
  ('f2220000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'outsider@example.com');

insert into public.teams (id, name) values
  ('faaa1111-0000-0000-0000-000000000000', 'Tunnel Team');
insert into public.team_members (team_id, user_id, role) values
  ('faaa1111-0000-0000-0000-000000000000', 'f1110000-0000-0000-0000-000000000001', 'owner');
insert into public.projects (id, team_id, name) values
  ('fbbb1111-0000-0000-0000-000000000000', 'faaa1111-0000-0000-0000-000000000000', 'Tunnel Proj');
insert into public.previews (id, project_id, slug, access_mode) values
  ('fccc1111-0000-0000-0000-000000000000', 'fbbb1111-0000-0000-0000-000000000000', 'tunnel-slug', 'team_only');

-- ===========================================================================
-- Member registers a valid cloudflared quick-tunnel URL (happy path).
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"f1110000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}';

select is(
  (select slug from public.register_preview_tunnel(
     'fccc1111-0000-0000-0000-000000000000',
     'https://blue-cat-runs-fast.trycloudflare.com',
     'guest_link')),
  'tunnel-slug',
  'member registers a *.trycloudflare.com https URL and gets the slug back');

set local role postgres;
select is(
  (select current_tunnel_url from public.previews where id = 'fccc1111-0000-0000-0000-000000000000'),
  'https://blue-cat-runs-fast.trycloudflare.com',
  'current_tunnel_url is persisted on the preview');
select is(
  (select status from public.previews where id = 'fccc1111-0000-0000-0000-000000000000'),
  'live',
  'preview is marked live (existing behavior preserved)');

-- localhost is accepted for dev.
set local role authenticated;
set local request.jwt.claims = '{"sub":"f1110000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}';
select is(
  (select slug from public.register_preview_tunnel(
     'fccc1111-0000-0000-0000-000000000000', 'https://localhost:8787')),
  'tunnel-slug',
  'a localhost https URL is accepted (dev)');

-- ===========================================================================
-- Allowlist rejections (P0001). Run as the member so authz passes first.
-- ===========================================================================
select throws_ok(
  $$ select public.register_preview_tunnel('fccc1111-0000-0000-0000-000000000000', 'http://blue-cat.trycloudflare.com') $$,
  'P0001', null, 'http scheme is rejected even with a trycloudflare host');

select throws_ok(
  $$ select public.register_preview_tunnel('fccc1111-0000-0000-0000-000000000000', 'https://evil.example.com') $$,
  'P0001', null, 'an arbitrary (evil) host is rejected');

select throws_ok(
  $$ select public.register_preview_tunnel('fccc1111-0000-0000-0000-000000000000', 'https://x.trycloudflare.com.attacker.com') $$,
  'P0001', null, 'a suffix-spoof host (…trycloudflare.com.attacker.com) is rejected');

select throws_ok(
  $$ select public.register_preview_tunnel('fccc1111-0000-0000-0000-000000000000', 'https://203.0.113.5') $$,
  'P0001', null, 'an IP-literal host is rejected');

select throws_ok(
  $$ select public.register_preview_tunnel('fccc1111-0000-0000-0000-000000000000', 'https://user:pass@x.trycloudflare.com') $$,
  'P0001', null, 'embedded credentials are rejected');

-- ===========================================================================
-- Authorization still gates first (42501): a valid URL is used so the
-- membership check is what trips, not the allowlist.
-- ===========================================================================
set local request.jwt.claims = '{"sub":"f2220000-0000-0000-0000-000000000002","role":"authenticated","is_anonymous":false}';
select throws_ok(
  $$ select public.register_preview_tunnel('fccc1111-0000-0000-0000-000000000000', 'https://blue-cat.trycloudflare.com') $$,
  '42501', null, 'a signed-in non-member is not authorized');

select * from finish();
rollback;
