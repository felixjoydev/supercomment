-- =============================================================================
-- workspace_rename.test.sql — U1 (migration 0024) Team -> Workspace rename
-- =============================================================================
-- pgTAP. Requires a LIVE Postgres + pgTAP with all migrations applied (the auth
-- schema + the security-definer helpers only exist on a real Supabase DB):
--   psql "$DATABASE_URL" -f supabase/tests/workspace_rename.test.sql
-- NOT runnable in the JS test sandbox.
--
-- Asserts the in-place rename landed:
--   * the three workspace tables exist; the three team tables are gone
--   * the team_id columns were renamed to workspace_id (and team_id is gone)
--   * the eight name-bearing helpers/RPCs exist under their workspace names;
--     the old is_team_* / create_team / accept_team_invite names are gone
--   * the embedded-flow surface is untouched: previews table + access_mode
--     column still present (the rename must not disturb the /s review flow)
-- =============================================================================

begin;
select plan(24);

-- --- tables: renamed in place -----------------------------------------------
select has_table('public', 'workspaces',        'workspaces table exists');
select has_table('public', 'workspace_members', 'workspace_members table exists');
select has_table('public', 'workspace_invites', 'workspace_invites table exists');

select hasnt_table('public', 'teams',        'teams table is gone');
select hasnt_table('public', 'team_members', 'team_members table is gone');
select hasnt_table('public', 'team_invites', 'team_invites table is gone');

-- --- columns: team_id -> workspace_id ---------------------------------------
select has_column('public',   'projects',          'workspace_id', 'projects.workspace_id exists');
select hasnt_column('public', 'projects',          'team_id',      'projects.team_id is gone');
select has_column('public',   'workspace_members', 'workspace_id', 'workspace_members.workspace_id exists');
select has_column('public',   'workspace_invites', 'workspace_id', 'workspace_invites.workspace_id exists');

-- --- functions: renamed helpers/RPCs exist ----------------------------------
select has_function('public', 'is_workspace_member',         array['uuid'], 'is_workspace_member(uuid) exists');
select has_function('public', 'is_workspace_owner',          array['uuid'], 'is_workspace_owner(uuid) exists');
select has_function('public', 'is_workspace_owner_or_admin', array['uuid'], 'is_workspace_owner_or_admin(uuid) exists');
select has_function('public', 'is_project_workspace_member', array['uuid'], 'is_project_workspace_member(uuid) exists');
select has_function('public', 'is_preview_workspace_member', array['uuid'], 'is_preview_workspace_member(uuid) exists');
select has_function('public', 'list_workspace_members',      array['uuid'], 'list_workspace_members(uuid) exists');
select has_function('public', 'create_workspace',            array['text'], 'create_workspace(text) exists');
select has_function('public', 'accept_workspace_invite',     array['text'], 'accept_workspace_invite(text) exists');

-- --- functions: old team-named identities are gone --------------------------
select hasnt_function('public', 'is_team_member',     'is_team_member is gone');
select hasnt_function('public', 'is_project_team_member', 'is_project_team_member is gone');
select hasnt_function('public', 'create_team',        'create_team is gone');
select hasnt_function('public', 'accept_team_invite', 'accept_team_invite is gone');

-- --- embedded review flow must be untouched by the rename -------------------
select has_table('public',  'previews',                 'previews table preserved (embedded flow)');
select has_column('public', 'previews', 'access_mode',  'previews.access_mode preserved (team_only/guest_link)');

select * from finish();
rollback;
