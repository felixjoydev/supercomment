-- =============================================================================
-- 0025_backfill_default_review_links.sql — Workspace IA (U2)
-- =============================================================================
-- Every project should own at least one review link (a `previews` row) so the
-- collapsed-preview dashboard works without a manual "Add preview" step (R5/R6).
-- Backfill one default review link for each existing project that has none.
--
-- Idempotent: only inserts for projects with zero previews, so re-running is a
-- no-op. Defaults: access_mode 'team_only' (members-only — the user flips to a
-- guest link to share externally), name 'Review link', a random non-secret slug
-- (the slug is not a secret; guest access still requires the link_secret).
-- =============================================================================
insert into public.previews (project_id, name, slug, access_mode)
select
  p.id,
  'Review link',
  'rl-' || substr(md5(random()::text || clock_timestamp()::text || p.id::text), 1, 10),
  'team_only'
from public.projects p
where not exists (select 1 from public.previews v where v.project_id = p.id);
