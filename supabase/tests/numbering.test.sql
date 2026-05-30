-- =============================================================================
-- pgTAP — atomic per-preview numbering + guest-link validation (AE4, AE8)
-- =============================================================================
-- Covers:
--   * valid guest link -> comment #1, trust=guest, author name recorded (AE8)
--   * three comments -> 1, 2, 3 (AE4)
--   * resolve #2 then insert -> #4 (no reuse / no renumber)
--   * expired / revoked(invalid) / team-only link secrets rejected
--   * member comment shares the same counter (-> #5) with trust=member
-- =============================================================================

begin;
select plan(12);

-- --- Fixtures (as superuser) ------------------------------------------------
set local role postgres;

insert into auth.users (id, aud, role, email) values
  ('11110000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'member@example.com');
insert into auth.users (id, aud, role, is_anonymous) values
  ('22220000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', true);

insert into public.teams (id, name) values
  ('aaaa1111-0000-0000-0000-000000000000', 'Num Team');
insert into public.team_members (team_id, user_id, role) values
  ('aaaa1111-0000-0000-0000-000000000000', '11110000-0000-0000-0000-000000000001', 'owner');
insert into public.projects (id, team_id, name) values
  ('bbbb1111-0000-0000-0000-000000000000', 'aaaa1111-0000-0000-0000-000000000000', 'Num Proj');

insert into public.previews (id, project_id, slug, access_mode, link_secret, expires_at) values
  ('cccc1111-0000-0000-0000-000000000000', 'bbbb1111-0000-0000-0000-000000000000', 'num-live',     'guest_link', 'num-secret',      null),
  ('cccc2222-0000-0000-0000-000000000000', 'bbbb1111-0000-0000-0000-000000000000', 'num-expired',  'guest_link', 'expired-secret',  now() - interval '1 hour'),
  ('cccc3333-0000-0000-0000-000000000000', 'bbbb1111-0000-0000-0000-000000000000', 'num-teamonly', 'team_only',  'teamonly-secret', null);

-- ===========================================================================
-- Guest creates comment #1 (AE8).
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"22220000-0000-0000-0000-000000000002","role":"authenticated","is_anonymous":true}';

create temporary table _r1 on commit drop as
  select * from public.create_guest_comment(
    'num-secret', '/page', 'Alice', 'fix', 'important', 'first note', '{}'::jsonb);

select is((select number from _r1), 1, 'AE8: first guest comment is numbered 1');
select is((select trust_level from _r1), 'guest', 'AE8: first guest comment trust=guest');

-- Author name lives on the participant; read it as superuser (guest cannot SELECT it).
set local role postgres;
select is(
  (select display_name from public.participants where id = (select author_participant from _r1)),
  'Alice', 'AE8: comment attributed to the entered display name');

-- ===========================================================================
-- Guest creates #2 and #3 (AE4).
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"22220000-0000-0000-0000-000000000002","role":"authenticated","is_anonymous":true}';

select is(
  (select number from public.create_guest_comment('num-secret', '/page', 'Alice', 'change', 'minor', 'second', '{}'::jsonb)),
  2, 'AE4: second guest comment is numbered 2');
select is(
  (select number from public.create_guest_comment('num-secret', '/page', 'Alice', 'question', 'minor', 'third', '{}'::jsonb)),
  3, 'AE4: third guest comment is numbered 3');

-- ===========================================================================
-- Resolve #2 (member), then guest inserts #4 — no reuse / renumber.
-- ===========================================================================
set local request.jwt.claims = '{"sub":"11110000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}';
select is(
  (select status from public.resolve_comment(
     (select c.id from public.comments c
        where c.preview_id = 'cccc1111-0000-0000-0000-000000000000' and c.number = 2),
     'fixed it')),
  'resolved', 'resolve_comment sets status=resolved on #2');

set local request.jwt.claims = '{"sub":"22220000-0000-0000-0000-000000000002","role":"authenticated","is_anonymous":true}';
select is(
  (select number from public.create_guest_comment('num-secret', '/page', 'Alice', 'fix', 'minor', 'fourth', '{}'::jsonb)),
  4, 'next comment after resolving #2 is #4 (numbers never reused)');

-- ===========================================================================
-- Link-secret validation.
-- ===========================================================================
-- expired link secret is rejected
select throws_ok(
  $$ select public.create_guest_comment('expired-secret', '/p', 'Eve', 'fix', 'minor', 'x', '{}'::jsonb) $$);

-- revoked/invalid link secret is rejected
select throws_ok(
  $$ select public.create_guest_comment('does-not-exist', '/p', 'Eve', 'fix', 'minor', 'x', '{}'::jsonb) $$);

-- team_only preview rejects the guest write path
select throws_ok(
  $$ select public.create_guest_comment('teamonly-secret', '/p', 'Eve', 'fix', 'minor', 'x', '{}'::jsonb) $$);

-- ===========================================================================
-- Member comment shares the same per-preview counter (-> #5).
-- ===========================================================================
set local request.jwt.claims = '{"sub":"11110000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}';

create temporary table _rm on commit drop as
  select * from public.create_member_comment(
    'cccc1111-0000-0000-0000-000000000000', '/page', 'Mike', 'change', 'minor', 'member note', '{}'::jsonb);

select is((select number from _rm), 5, 'member comment continues the same counter (-> #5)');
select is((select trust_level from _rm), 'member', 'member comment trust=member');

select * from finish();
rollback;
