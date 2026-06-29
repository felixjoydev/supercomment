-- =============================================================================
-- mint_review_token.test.sql — U2 (migration 0018)
-- pgTAP. Requires a live Postgres + pgTAP with migrations applied:
--   psql "$DATABASE_URL" -f supabase/tests/mint_review_token.test.sql
-- Not runnable in the JS test sandbox.
-- =============================================================================
begin;
select plan(6);

-- table + RPC exist
select has_table('public', 'review_tokens', 'review_tokens table exists');
select has_function(
  'public', 'mint_review_token', array['text', 'text', 'text'],
  'mint_review_token(text,text,text) exists'
);

-- A preview with NO deploy_url is not embeddable (falls back to tunnel path).
-- (Seed a team/project/preview without deploy_url, then expect the exception.)
-- These are illustrative; a full harness seeds fixtures first.
select throws_ok(
  $$ select public.mint_review_token('does-not-exist', 'tok', null) $$,
  'preview_not_found',
  'unknown slug raises preview_not_found'
);

-- Single-use + TTL are enforced by used_at / expires_at columns.
select has_column('public', 'review_tokens', 'used_at', 'review_tokens.used_at exists (single-use)');
select has_column('public', 'review_tokens', 'expires_at', 'review_tokens.expires_at exists (TTL)');
select col_is_unique('public', 'review_tokens', 'token', 'review_tokens.token is unique');

select * from finish();
rollback;
