-- =============================================================================
-- 0016_embedded_review_schema.sql — Embedded Deployed Review Mode (U7)
-- =============================================================================
-- Foundation schema for the embedded model:
--   * previews.deploy_url — the developer's own always-on deployed preview
--     origin the embedded /s link redirects reviewers to (validated against an
--     allowlist by register_deploy_target in 0017). Distinct from the ephemeral
--     current_tunnel_url used by the now-dormant tunnel mode.
--   * comments.is_stale — set when re-anchoring can no longer resolve a
--     comment's element on the current deploy. Orthogonal to status
--     (open/resolved/dismissed): a stale comment stays visible until resolved.
--
-- Per-comment PROVENANCE (which deploy URL + commit a comment was captured
-- against, R14) rides in comments.context jsonb via CapturedContext.deployUrl /
-- .commit in packages/shared/src/schema.ts — no column is added for it here.
--
-- NOTE: 0012-0014 are reserved by the hardening branch (already applied to the
-- dev DB as share_access / guest_abuse_hardening / team_invites). This branch
-- jumps 0011 -> 0015 -> 0016 to avoid a merge collision. Inspect those before
-- adding 0017+ that touch share access or guest abuse.
-- =============================================================================

alter table public.previews
  add column if not exists deploy_url text;

alter table public.comments
  add column if not exists is_stale boolean not null default false;

-- Partial index: the dashboard/overlay query for "comments that went stale on
-- this preview" hits only the few stale rows.
create index if not exists comments_is_stale_idx
  on public.comments (preview_id, is_stale)
  where is_stale;
