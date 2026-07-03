-- =============================================================================
-- 0030_enable_rls_review_tables.sql — CRITICAL security hotfix (C1/C2)
-- =============================================================================
-- review_tokens (0018) and review_sessions (0019) shipped WITHOUT
-- `enable row level security`. Combined with the schema-wide default grant from
-- 0001 (`alter default privileges ... grant select,insert,update,delete on
-- tables to anon, authenticated`), every later table inherits full DML for anon
-- AND authenticated, and RLS is the only gate — which was never turned on here.
--
-- Impact (confirmed on the live DB via the security advisor):
--   * review_tokens: anon `GET /rest/v1/review_tokens?select=*` dumps every
--     token + member email/display_name/preview_id across ALL tenants; and
--     INSERT/UPDATE/DELETE let an attacker forge or evict tokens/sessions.
--   * review_sessions: an anonymous sign-in can INSERT a `role='member'` session
--     row for any preview, bypassing the entire mint->exchange->token flow, the
--     link_secret, team_only, Turnstile, and the guest caps — then read+write the
--     thread AS A MEMBER.
--
-- Fix: enable RLS on both tables and revoke the inherited anon/authenticated
-- grants. ALL legitimate access is through the SECURITY DEFINER RPCs
-- (mint_review_token / establish_review_session / create_review_comment), which
-- run as the table owner and are unaffected by RLS. With RLS on and NO policies,
-- every direct PostgREST path (anon or authenticated, incl. anonymous sign-ins
-- which authenticate as `authenticated`) is denied — fail closed. Verified: no
-- code in apps/ or packages/ reads these tables directly (only via the RPCs).
--
-- Root cause is also fixed: the 0001 default-privilege grant to anon/authenticated
-- is revoked so a FUTURE table that forgets `enable row level security` fails
-- CLOSED (no direct grant) instead of open. Existing tables keep their explicit
-- 0001 grants; this changes only what tables created LATER inherit. Anonymous
-- sign-ins get the `authenticated` role, so BOTH roles are dropped from the
-- default. service_role / postgres are untouched.
--
-- Idempotent + reversible: enabling RLS, revoking grants, and revoking default
-- privileges are all no-ops if already applied.
-- =============================================================================

-- 1. Enable RLS on the two exposed tables (fail closed; RPCs bypass as owner).
alter table public.review_tokens   enable row level security;
alter table public.review_sessions enable row level security;

-- 2. Revoke the inherited direct grants (undo the 0001 default on these tables).
--    No policies are added, so all direct anon/authenticated REST access is now
--    denied. The definer RPCs continue to work (they run as the owner).
revoke all on public.review_tokens   from anon, authenticated;
revoke all on public.review_sessions from anon, authenticated;

-- 3. Root-cause fix: stop future tables from inheriting a blanket anon/authenticated
--    DML grant. Migrations run as `postgres`, so this REVOKE (undoing 0001's
--    `alter default privileges ... grant ... to anon, authenticated`) makes a
--    future migration table that forgets RLS fail closed. The core tables were
--    granted EXPLICITLY in 0001 and are unaffected; grant new tables explicitly.
alter default privileges in schema public
  revoke select, insert, update, delete on tables from anon, authenticated;
