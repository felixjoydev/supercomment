-- =============================================================================
-- handoff_privacy.test.sql — U13 early wire-privacy proof
-- =============================================================================
-- pgTAP. Requires a LIVE Postgres with all migrations through 0046 applied
-- (0043 agent_prompts/set_agent_prompt/get_agent_prompt; 0044
-- agent_reference_confirmations/send_comment_to_agent + comment_queue's
-- prompt_snapshot/prompt_snapshot_author/prompt_snapshot_at columns; 0046
-- scrub_prompt_overlap fix + dismiss_comment scrub, see scenario 6b).
--
-- Purpose (R2, R9): prove the highest-risk invariant -- a workspace member's
-- private prompt/instruction, and the fact that a guest send was confirmed,
-- NEVER reach a guest reviewer, whether they ask directly (RLS) or just listen
-- on the wire (realtime broadcast) -- right after the storage/send paths
-- landed (U2/U3), before any authoring surface or MCP payload assembly builds
-- on top of it. A failure here should block Phase B/C outright.
--
-- Fixtures mirror agent_prompt_rls.test.sql (U2) / send_comment_to_agent.test.sql
-- (U3): POST-0024 workspace naming (workspaces/workspace_members), `set local
-- role authenticated` + `set local request.jwt.claims`, a review_sessions row
-- for the guest reviewer. pgtap is NOT permanently installed on this project
-- (list_extensions shows installed_version: null) -- `create extension` is
-- transactional, so installing it inside this same rolled-back transaction
-- makes plan()/is()/finish() available for the duration of the run without
-- leaving the extension behind afterward.
--
-- Scenarios (see the plan() count below for the exact assertion tally):
--   1. Consolidated regression guard: neither agent_prompts (U2) nor
--      agent_reference_confirmations (U3) has any trigger, and neither is a
--      member of any realtime publication. U2/U3's own test files already
--      assert a version of this per-table; re-asserted here so this one file
--      is a self-contained "wire privacy" proof across both tables.
--   2. A set_agent_prompt write changes NEITHER the realtime.messages row
--      count on the preview's topic NOR contains the prompt text anywhere on
--      that topic. Measured as a before/after delta around the RPC call
--      (rather than asserting a bare zero) because comments.INSERT/UPDATE on
--      this same preview legitimately broadcasts (0004) -- the delta is what
--      isolates "did THIS call broadcast anything".
--   3. A guest reads zero rows -- directly, bypassing every RPC -- from
--      agent_prompts, agent_reference_confirmations, and comment_queue
--      (including its prompt_snapshot column), scoped to the WHOLE preview so
--      the check isn't vacuous (rows exist for both by this point in the
--      file, thanks to scenario 4 below running first). comment_queue's RLS
--      (member-only via is_preview_workspace_member, originally
--      is_preview_team_member pre-0024, from 0006/u9_comment_queue) already
--      excluded guests entirely before prompt_snapshot existed -- this
--      reconfirms that EXISTING boundary still holds now that
--      prompt_snapshot rides the same row, rather than asserting a new one.
--   4. A confirmed guest send (send_comment_to_agent) sets the confirm
--      marker and snapshots the live prompt, but: does not change
--      comments.status, does not bump comments.status_changed_at (added in
--      0037 alongside a trigger that only fires `if new.status is distinct
--      from old.status` -- send_comment_to_agent never touches
--      comments.status at all, so this is a direct, exact assertion rather
--      than an adapted one), and does not change the realtime.messages count
--      or ever place the prompt text in a payload on the preview's topic.
--      NOTE ON THE PLAN'S WORDING: the plan describes this as "does not bump
--      comments.status_changed_at" -- that column DOES exist in this schema
--      (0037), so no adaptation was needed here; it maps directly.
--   5. The captures storage bucket (0027, hardened by 0031/0032) exposes no
--      UPDATE or DELETE policy on storage.objects scoped to the captures
--      bucket, for any role -- a dynamic pg_policies sweep by `cmd`, not a
--      hardcoded policy-name/count list, per security_audit.sql's house
--      style. (0027 only ever defined bucket-scoped RLS POLICIES, not
--      bucket-scoped GRANTs -- storage.objects grants are table-wide, not
--      per-bucket -- so the policy sweep is the correct and only mechanism
--      that can be scoped to "the captures bucket specifically".) A second
--      assertion sanity-checks the filter actually matched the real
--      upload/read policies (>= 2), so the "zero UPDATE/DELETE" result can't
--      be a false-negative from an empty match set.
--   6. resolve_comment's prompt/summary-overlap scrub (U6, 0045): a resolve
--      summary that normalized-overlaps the comment's live private prompt is
--      blanked to NULL (not left verbatim, not a placeholder string -- see
--      0045's header for why NULL specifically); a summary with NO overlap,
--      and a comment with NO live prompt at all, resolve exactly as before.
-- =============================================================================

begin;

create extension if not exists pgtap;

select plan(28);

-- ---------------------------------------------------------------------------
-- Fixtures (as superuser).
-- ---------------------------------------------------------------------------
set local role postgres;

-- Alice: a real workspace member (dashboard path, no review_sessions row),
-- granted can_send_to_agent so the send_comment_to_agent call in scenario 4
-- succeeds. A single anonymous guest reviewer (review_sessions role=guest).
insert into auth.users (id, aud, role, email) values
  ('f0040000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'alice-h13@example.com');
insert into auth.users (id, aud, role, is_anonymous) values
  ('f0040000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', true);

insert into public.workspaces (id, name) values
  ('f0010000-0000-0000-0000-000000000001', 'Handoff Privacy Test Workspace');

insert into public.workspace_members (workspace_id, user_id, role, can_send_to_agent) values
  ('f0010000-0000-0000-0000-000000000001', 'f0040000-0000-0000-0000-000000000001', 'owner', true);

insert into public.projects (id, workspace_id, name) values
  ('f0020000-0000-0000-0000-000000000001', 'f0010000-0000-0000-0000-000000000001', 'Handoff Privacy Test Project');

insert into public.previews (id, project_id, slug, access_mode, link_secret) values
  ('f0030000-0000-0000-0000-000000000001', 'f0020000-0000-0000-0000-000000000001',
     'handoff-privacy-preview', 'guest_link', 'hp13-secret');

insert into public.participants (id, preview_id, user_id, display_name, trust_level) values
  ('f0050000-0000-0000-0000-000000000001', 'f0030000-0000-0000-0000-000000000001',
     'f0040000-0000-0000-0000-000000000001', 'Alice', 'member'),
  ('f0050000-0000-0000-0000-000000000002', 'f0030000-0000-0000-0000-000000000001',
     null, 'Gary Guest', 'guest');

-- Comment P: member-authored, used only for the set_agent_prompt broadcast
-- check (scenario 2). Comment G: guest-authored, used only for the
-- send_comment_to_agent check (scenario 4) -- its resulting queue/marker
-- rows are what make scenario 3's guest zero-read checks non-vacuous.
insert into public.comments
  (id, preview_id, number, author_participant, trust_level, intent, severity, note) values
  ('f0060000-0000-0000-0000-000000000001', 'f0030000-0000-0000-0000-000000000001', 1,
     'f0050000-0000-0000-0000-000000000001', 'member', 'fix', 'important', 'comment P'),
  ('f0060000-0000-0000-0000-000000000002', 'f0030000-0000-0000-0000-000000000001', 2,
     'f0050000-0000-0000-0000-000000000002', 'guest', 'fix', 'important', 'comment G');

insert into public.review_sessions
  (anon_user_id, preview_id, role, member_user_id, display_name, expires_at) values
  ('f0040000-0000-0000-0000-000000000002', 'f0030000-0000-0000-0000-000000000001',
     'guest', null, 'Gary Guest (overlay)', now() + interval '8 hours');

-- ===========================================================================
-- Sanity: the objects this suite depends on exist.
-- ===========================================================================
select has_table('public', 'agent_prompts', 'agent_prompts table exists');
select has_table('public', 'agent_reference_confirmations', 'agent_reference_confirmations table exists');
select has_column('public', 'comment_queue', 'prompt_snapshot', 'comment_queue.prompt_snapshot column exists');

-- ===========================================================================
-- Scenario 1: consolidated no-trigger / no-publication guard, both tables.
-- ===========================================================================
select is(
  (select count(*)::int from pg_trigger
     where tgrelid = 'public.agent_prompts'::regclass and not tgisinternal),
  0, 'agent_prompts has no triggers (no broadcast trigger can ride this table)');
select is(
  (select count(*)::int from pg_trigger
     where tgrelid = 'public.agent_reference_confirmations'::regclass and not tgisinternal),
  0, 'agent_reference_confirmations has no triggers (no broadcast trigger can ride this table)');
select is(
  (select count(*)::int from pg_publication_tables
     where schemaname = 'public' and tablename = 'agent_prompts'),
  0, 'agent_prompts is not part of any realtime publication');
select is(
  (select count(*)::int from pg_publication_tables
     where schemaname = 'public' and tablename = 'agent_reference_confirmations'),
  0, 'agent_reference_confirmations is not part of any realtime publication');

-- ===========================================================================
-- Scenario 2: a set_agent_prompt write does not move the realtime wire.
-- Capture the preview topic's realtime.messages count immediately before and
-- after the call (not a bare zero -- other things on this preview, e.g. a
-- comment INSERT, legitimately broadcast per 0004) and assert no delta, plus
-- assert the prompt text never appears in any payload on that topic.
-- ===========================================================================
set local role postgres;
select set_config(
  'h13.msg_before',
  (select count(*)::text from realtime.messages where topic = 'preview:f0030000-0000-0000-0000-000000000001'),
  true);

set local role authenticated;
set local request.jwt.claims = '{"sub":"f0040000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}';
select public.set_agent_prompt(
  'f0060000-0000-0000-0000-000000000001',
  'PRIVATE_PROMPT_MARKER_P_9f3d: check the spacing against the Figma spec.');

set local role postgres;
select is(
  (select count(*)::text from realtime.messages where topic = 'preview:f0030000-0000-0000-0000-000000000001'),
  current_setting('h13.msg_before'),
  'set_agent_prompt does not change the realtime.messages count on the preview topic');
select is(
  (select count(*)::int from realtime.messages
     where topic = 'preview:f0030000-0000-0000-0000-000000000001'
       and payload::text ilike '%PRIVATE_PROMPT_MARKER_P%'),
  0, 'no realtime.messages payload on the preview topic ever contains the prompt text');

-- ===========================================================================
-- Scenario 4: a confirmed guest send (marker-set) does not move the wire and
-- does not make the comment look "changed" to a guest.
-- (Run before scenario 3 so its resulting rows make the guest zero-read
-- checks below non-vacuous.)
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"f0040000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}';
select public.set_agent_prompt(
  'f0060000-0000-0000-0000-000000000002',
  'PRIVATE_PROMPT_MARKER_G_2a71: verify the guest reference image before hand-off.');

set local role postgres;
select set_config(
  'h13.g_status_before',
  (select status from public.comments where id = 'f0060000-0000-0000-0000-000000000002'),
  true);
select set_config(
  'h13.g_changed_before',
  (select status_changed_at::text from public.comments where id = 'f0060000-0000-0000-0000-000000000002'),
  true);
select set_config(
  'h13.msg_before2',
  (select count(*)::text from realtime.messages where topic = 'preview:f0030000-0000-0000-0000-000000000001'),
  true);

set local role authenticated;
set local request.jwt.claims = '{"sub":"f0040000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}';
create temporary table _send1 on commit drop as
  select * from public.send_comment_to_agent('f0060000-0000-0000-0000-000000000002', true);

select is((select count(*)::int from _send1), 1, 'the confirmed guest send succeeds and returns exactly one row');
select is(
  (select prompt_snapshot from _send1),
  'PRIVATE_PROMPT_MARKER_G_2a71: verify the guest reference image before hand-off.',
  'sanity: the queue row snapshots the live prompt (proves the guest zero-read check below is not vacuous)');

set local role postgres;
select is(
  (select status from public.comments where id = 'f0060000-0000-0000-0000-000000000002'),
  current_setting('h13.g_status_before'),
  'send_comment_to_agent does not change comments.status');
select is(
  (select status_changed_at::text from public.comments where id = 'f0060000-0000-0000-0000-000000000002'),
  current_setting('h13.g_changed_before'),
  'send_comment_to_agent does not bump comments.status_changed_at (only bumped on an actual status change, per the 0037 trigger) -- so the comment does not look changed/unread to a guest');
select is(
  (select count(*)::text from realtime.messages where topic = 'preview:f0030000-0000-0000-0000-000000000001'),
  current_setting('h13.msg_before2'),
  'send_comment_to_agent (marker set + queue insert) does not change the realtime.messages count on the preview topic');
select is(
  (select count(*)::int from realtime.messages
     where topic = 'preview:f0030000-0000-0000-0000-000000000001'
       and payload::text ilike '%PRIVATE_PROMPT_MARKER_G%'),
  0, 'no realtime.messages payload on the preview topic ever contains the guest-send prompt text');

-- ===========================================================================
-- Scenario 3: a guest reads zero rows directly from all three tables that now
-- carry private handoff data, scoped to the WHOLE preview (2 agent_prompts
-- rows -- P and G -- 1 confirmation row, and 1 queue row now exist).
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"f0040000-0000-0000-0000-000000000002","role":"authenticated","is_anonymous":true}';

select is(
  (select count(*)::int from public.agent_prompts where preview_id = 'f0030000-0000-0000-0000-000000000001'),
  0, 'a guest reads zero rows from agent_prompts directly, even though 2 rows now exist for this preview');
select is(
  (select count(*)::int from public.agent_reference_confirmations where preview_id = 'f0030000-0000-0000-0000-000000000001'),
  0, 'a guest reads zero rows from agent_reference_confirmations directly, even though a marker now exists');
select is(
  (select count(*)::int from public.comment_queue where preview_id = 'f0030000-0000-0000-0000-000000000001'),
  0, 'a guest reads zero rows from comment_queue directly, including its prompt_snapshot column -- reconfirms the EXISTING member-only boundary (0006, is_preview_team_member -> renamed is_preview_workspace_member by 0024) still holds now that prompt_snapshot rides the same row');

-- ===========================================================================
-- Scenario 5: the captures storage bucket exposes no UPDATE/DELETE policy on
-- storage.objects scoped to it, for any role (create-only invariant, 0027,
-- hardened by 0031/0032) -- the guard the sticky guest-confirm marker rests
-- on (an already-confirmed guest reference must never be mutated in place).
-- Dynamic sweep over pg_policies by cmd, not a hardcoded policy count.
-- ===========================================================================
set local role postgres;
select is(
  (select count(*)::int from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and (coalesce(qual, '') ilike '%captures%' or coalesce(with_check, '') ilike '%captures%')
       and cmd in ('UPDATE', 'DELETE', 'ALL')),
  0, 'the captures bucket exposes no UPDATE/DELETE (or ALL) policy on storage.objects, for any role');
select cmp_ok(
  (select count(*)::int from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and (coalesce(qual, '') ilike '%captures%' or coalesce(with_check, '') ilike '%captures%')
       and cmd in ('SELECT', 'INSERT')),
  '>=', 2,
  'sanity: the captures upload/read policies are still present, so the zero-UPDATE/DELETE result above is not a false negative from an empty match set');

-- ===========================================================================
-- Scenario 6: resolve_comment's prompt/summary-overlap scrub (U6, 0045).
-- Comment P (from scenario 2) still carries its live prompt
-- ('PRIVATE_PROMPT_MARKER_P_9f3d: check the spacing against the Figma
-- spec.') and is still OPEN -- scenarios 2-5 above never resolve it -- so it
-- is reused here rather than adding a fresh comment: resolve_comment does
-- not gate on the CURRENT status when called, matching its pre-U6 behavior,
-- so resolving it (twice, for the two summary cases below) is safe.
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"f0040000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}';

-- Case A: a summary that normalized-overlaps the live prompt (verbatim
-- chunk, different case, extra surrounding text) -- expect the summary
-- BLANKED to NULL, but the resolve action itself still succeeds.
create temporary table _resolve_overlap on commit drop as
  select status, resolved_summary from public.resolve_comment(
    'f0060000-0000-0000-0000-000000000001',
    'Done: PRIVATE_PROMPT_MARKER_P_9f3d: CHECK THE SPACING against the Figma spec. Verified.'
  );
select is(
  (select resolved_summary from _resolve_overlap),
  null,
  'resolve_comment blanks resolved_summary to NULL when it normalized-overlaps the live private prompt (R9)');
select is(
  (select status from _resolve_overlap),
  'resolved',
  'the resolve action itself still succeeds even when its summary is blanked for overlap');

-- Case B: a summary with NO overlap against the same live prompt -- resolves
-- with the summary intact (re-resolving the same comment is a benign no-op
-- status-wise; only resolved_summary is under test here).
create temporary table _resolve_no_overlap on commit drop as
  select resolved_summary from public.resolve_comment(
    'f0060000-0000-0000-0000-000000000001',
    'Adjusted the header padding to match the design.'
  );
select is(
  (select resolved_summary from _resolve_no_overlap),
  'Adjusted the header padding to match the design.',
  'a resolve summary with no overlap against the live prompt resolves with the summary intact');

-- Case C: a comment with NO live prompt at all resolves exactly as before --
-- no scrub effect when there is nothing to scrub against.
set local role postgres;
insert into public.comments
  (id, preview_id, number, author_participant, trust_level, intent, severity, note) values
  ('f0060000-0000-0000-0000-000000000003', 'f0030000-0000-0000-0000-000000000001', 3,
     'f0050000-0000-0000-0000-000000000001', 'member', 'fix', 'important', 'comment P2 (no prompt)');

set local role authenticated;
set local request.jwt.claims = '{"sub":"f0040000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}';
create temporary table _resolve_no_prompt on commit drop as
  select resolved_summary from public.resolve_comment(
    'f0060000-0000-0000-0000-000000000003',
    'No related prompt exists for this comment; summary should pass through untouched.'
  );
select is(
  (select resolved_summary from _resolve_no_prompt),
  'No related prompt exists for this comment; summary should pass through untouched.',
  'a comment with no live prompt at all resolves with its summary fully intact (no behavior change)');

-- ===========================================================================
-- Scenario 6b: 0046 fixes -- the line-break/short-prompt scrub bypass three
-- independent code reviewers (testing, security, adversarial) found in
-- scenario 6's original per-line chunking, plus dismiss_comment's symmetric
-- gap (correctness finding: 0045 never scrubbed dismiss_comment at all).
-- ===========================================================================
set local role postgres;
insert into public.comments
  (id, preview_id, number, author_participant, trust_level, intent, severity, note) values
  ('f0060000-0000-0000-0000-000000000004', 'f0030000-0000-0000-0000-000000000001', 4,
     'f0050000-0000-0000-0000-000000000001', 'member', 'fix', 'important', 'comment P3 (linebreak prompt)'),
  ('f0060000-0000-0000-0000-000000000005', 'f0030000-0000-0000-0000-000000000001', 5,
     'f0050000-0000-0000-0000-000000000001', 'member', 'fix', 'important', 'comment P4 (short prompt)'),
  ('f0060000-0000-0000-0000-000000000006', 'f0030000-0000-0000-0000-000000000001', 6,
     'f0050000-0000-0000-0000-000000000001', 'member', 'fix', 'important', 'comment P5 (trivial prompt, dismiss path)');

set local role authenticated;
set local request.jwt.claims = '{"sub":"f0040000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}';

select public.set_agent_prompt('f0060000-0000-0000-0000-000000000004', E'skip the null check\nfor the guest path entirely');
select public.set_agent_prompt('f0060000-0000-0000-0000-000000000005', 'hide auth bug');
select public.set_agent_prompt('f0060000-0000-0000-0000-000000000006', 'ok');

-- Case D: a summary that echoes a prompt whose sensitive content straddles a
-- LINE BREAK (flattened to a space in prose, as any summary naturally would)
-- -- the original per-line chunking missed this; the sliding-window fix over
-- the flattened prompt must catch it.
select is(
  (select resolved_summary from public.resolve_comment(
    'f0060000-0000-0000-0000-000000000004',
    'Done: skip the null check for the guest path entirely. Verified in staging.'
  )),
  null,
  '0046: a summary echoing a prompt that straddles a line break is now blanked (was NOT caught pre-0046)');

-- Case E: a short (13-char) but distinctive prompt, previously exempt under
-- the old 15-char-per-line floor -- must now be caught (new floor is 8).
select is(
  (select resolved_summary from public.resolve_comment(
    'f0060000-0000-0000-0000-000000000005',
    'I decided to hide auth bug for now, will revisit next sprint.'
  )),
  null,
  '0046: a short (13-char) but distinctive prompt overlap is now blanked (was exempt pre-0046 under the old 15-char floor)');

-- Case F: a TRIVIAL 2-char prompt ("ok") must still be exempt -- the lowered
-- floor (8, from 15) must not start false-positiving on generic filler.
select is(
  (select resolved_summary from public.resolve_comment(
    'f0060000-0000-0000-0000-000000000006',
    'ok, this looks good, shipping it'
  )),
  'ok, this looks good, shipping it',
  '0046: a trivial 2-char prompt ("ok") still does not trigger a false positive');

-- Case G: dismiss_comment now carries the SAME scrub (0045 never added one).
-- Reuses comment P3's line-break prompt (case D already resolved it, but
-- resolve_comment/dismiss_comment don't gate on current status, matching
-- pre-existing behavior) to prove the guard is symmetric across both RPCs.
select is(
  (select resolved_summary from public.dismiss_comment(
    'f0060000-0000-0000-0000-000000000004',
    'wontfix: skip the null check for the guest path entirely, not worth it'
  )),
  null,
  '0046: dismiss_comment blanks resolved_summary on the same overlap check resolve_comment uses (0045 never scrubbed dismiss_comment at all)');

select * from finish();
rollback;
