-- =============================================================================
-- embedded_schema.test.sql — U7 (migration 0016) column additions
-- pgTAP. Run against a DB with migrations applied:
--   psql "$DATABASE_URL" -f supabase/tests/embedded_schema.test.sql
-- (Requires a live Postgres + pgTAP; not runnable in the JS test sandbox.)
-- =============================================================================
begin;
select plan(5);

-- previews.deploy_url (the embedded /s redirect target)
select has_column('public', 'previews', 'deploy_url', 'previews.deploy_url exists');
select col_type_is('public', 'previews', 'deploy_url', 'text', 'previews.deploy_url is text');
select col_is_null('public', 'previews', 'deploy_url', 'previews.deploy_url is nullable');

-- comments.is_stale (redeploy reconciliation marker, orthogonal to status)
select has_column('public', 'comments', 'is_stale', 'comments.is_stale exists');
select col_default_is(
  'public', 'comments', 'is_stale', 'false',
  'comments.is_stale defaults to false'
);

select * from finish();
rollback;
