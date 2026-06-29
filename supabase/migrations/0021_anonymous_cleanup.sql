-- =============================================================================
-- 0021_anonymous_cleanup.sql — Embedded Deployed Review Mode (U4 hardening)
-- =============================================================================
-- The embedded guest path does an ANONYMOUS Supabase sign-in per reviewer
-- (auth/session.ts → /auth/v1/signup). Over time that accumulates anonymous
-- auth.users rows. This migration installs a daily purge of STALE anonymous
-- users (no active review_sessions, older than N days) and schedules it via
-- pg_cron.
--
-- ┌─────────────────────────────────────────────────────────────────────────┐
-- │ REAL-ENV APPLY STEP — this migration REQUIRES:                           │
-- │   * pg_cron ENABLED in the project (Supabase: Database → Extensions, or  │
-- │     `create extension pg_cron`). pg_cron installs into the `postgres`     │
-- │     database only.                                                        │
-- │   * ELEVATED PRIVILEGES for the migration role: the purge function is    │
-- │     SECURITY DEFINER and DELETEs from the `auth` schema (auth.users,     │
-- │     auth.identities, auth.sessions). The owner must have those rights    │
-- │     (Supabase's `postgres`/migration role does).                          │
-- │                                                                          │
-- │ It is IDEMPOTENT and DEGRADES SAFELY: the function is always created;    │
-- │ the extension + scheduling run inside a guarded DO block that emits a    │
-- │ NOTICE (instead of failing the migration) when pg_cron is unavailable —  │
-- │ so applying this file in a local/dev DB without pg_cron does NOT break    │
-- │ the migration chain. In real env, enable pg_cron and re-apply (or run    │
-- │ the scheduling block) so the job is registered.                          │
-- └─────────────────────────────────────────────────────────────────────────┘
-- =============================================================================

-- ---------------------------------------------------------------------------
-- purge_stale_anonymous_users — delete anonymous auth.users that have no active
--   review session and are older than `p_older_than` (default 30 days).
--
--   "Active" = an unexpired public.review_sessions row (expires_at > now()).
--   Members (real accounts) are never anonymous (is_anonymous is false/null), so
--   they are never selected.
--
--   Deletion ORDER is explicit (auth.sessions → auth.identities → auth.users)
--   to handle the auth cascade robustly regardless of the project's FK ON DELETE
--   settings; deleting auth.users alone also cascades on a stock Supabase schema,
--   so the explicit child deletes are belt-and-suspenders. Orphaned (expired)
--   public.review_sessions rows for the purged users are tidied too.
--
--   SECURITY DEFINER so the cron job can run it even if the cron role lacks
--   direct auth-schema privileges; `set search_path = ''` per house style.
--   Returns the number of anonymous users deleted (for logging / manual runs).
-- ---------------------------------------------------------------------------
create or replace function public.purge_stale_anonymous_users(
  p_older_than interval default interval '30 days'
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids     uuid[];
  v_deleted integer;
begin
  -- Collect stale anonymous user ids: anonymous, old enough, and with no
  -- currently-active review session.
  select array_agg(u.id) into v_ids
  from auth.users u
  where coalesce(u.is_anonymous, false) = true
    and u.created_at < now() - p_older_than
    and not exists (
      select 1
      from public.review_sessions rs
      where rs.anon_user_id = u.id
        and rs.expires_at > now()
    );

  if v_ids is null then
    return 0;
  end if;

  -- Tidy our own (expired) sessions for these users (no FK to auth.users).
  delete from public.review_sessions where anon_user_id = any(v_ids);

  -- Auth cascade — explicit children first, then the user (also cascades).
  delete from auth.sessions   where user_id = any(v_ids);
  delete from auth.identities where user_id = any(v_ids);
  delete from auth.users      where id      = any(v_ids);

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

-- Internal maintenance only — not callable by anon/authenticated. The cron job
-- runs as the scheduling (owner) role, which can execute it without a grant.
revoke all on function public.purge_stale_anonymous_users(interval) from public;

-- ---------------------------------------------------------------------------
-- Enable pg_cron + (re)schedule the daily purge — guarded + idempotent.
--   The whole block is wrapped so a DB without pg_cron (local/dev) gets a NOTICE
--   instead of a hard failure. Re-running unschedules any prior job of the same
--   name first, so applying twice does not create duplicate schedules.
-- ---------------------------------------------------------------------------
do $$
begin
  -- REAL ENV: requires privileges to install extensions. No-op if already present.
  create extension if not exists pg_cron;

  -- Idempotent (re)schedule: drop an existing job of this name, then add it.
  if exists (select 1 from cron.job where jobname = 'purge-stale-anonymous-users') then
    perform cron.unschedule('purge-stale-anonymous-users');
  end if;

  -- Daily at 04:17 UTC. N defaults to 30 days inside the function.
  perform cron.schedule(
    'purge-stale-anonymous-users',
    '17 4 * * *',
    $cron$ select public.purge_stale_anonymous_users(interval '30 days'); $cron$
  );

  raise notice 'pg_cron job "purge-stale-anonymous-users" scheduled (daily 04:17 UTC).';
exception
  when others then
    -- pg_cron unavailable / insufficient privilege (e.g. local dev): keep the
    -- migration green; the purge function still exists and can be scheduled
    -- manually once pg_cron is enabled in the real environment.
    raise notice 'pg_cron not enabled (%: %); purge function created but NOT scheduled. Enable pg_cron and schedule purge-stale-anonymous-users in real env.', sqlstate, sqlerrm;
end
$$;
