-- =============================================================================
-- 0027_capture_storage.sql — Visual Live-Editing (U4)
-- =============================================================================
-- A private Supabase Storage bucket for real screenshots (R15–R18) and
-- reviewer-uploaded reference images (R19). Real rasters are binary + large, so
-- they are stored OUT-OF-BAND here and referenced by path from
-- comments.context.screenshot / .referenceImages — never inlined (an inlined PNG
-- would blow the 3 MiB guest context cap from 0020 and bloat every read).
--
-- AUTH MODEL (why session-based RLS, NOT JWT claims):
--   The reviewer holds a Supabase-issued ANONYMOUS AUTH JWT (from the anon
--   sign-in in the embedded flow) — we do not mint it and it carries no custom
--   project/preview claims, and the preview isn't even known at sign-in. So the
--   original plan's "add project/preview claims to the token" (U5) does NOT fit
--   this architecture and is ELIMINATED. Instead we scope exactly like
--   create_review_comment (0019/0020): look up an unexpired review_sessions row
--   for (auth.uid(), preview). Anonymous reviewers run as the `authenticated`
--   role (Supabase anonymous sign-ins are is_anonymous authenticated users), so
--   the policies target `authenticated`.
--
-- PATH CONVENTION: `<preview_id>/<uuid>.<ext>`. RLS scopes by the leading
--   preview_id segment. We compare `<uuid>::text = segment` rather than casting
--   the untrusted path segment to uuid, so a malformed path simply fails to match
--   instead of raising a cast error inside policy evaluation.
--
-- SIZE/TYPE CAPS are enforced SERVER-SIDE by the bucket (file_size_limit +
--   allowed_mime_types); guest upload VOLUME is bounded by the existing 0020
--   comment rate cap (each capture rides a comment submit).
--
-- House style mirrors 0002_rls / 0021: SECURITY DEFINER + `set search_path = ''`
--   on the cleanup fn, schema-qualified identifiers, REVOKE from public.
--
-- REAL-ENV GATE (cannot be exercised in the sandbox — validate against live
--   Supabase in a rolled-back txn before push):
--   * bucket creation + file_size_limit / allowed_mime_types enforcement,
--   * the storage.objects RLS (upload within session; read as member/reviewer),
--   * the storage.objects RLS (upload within session; read as member/reviewer).
-- Validated against the live supercomment DB (2026-07-01): create_review_comment
-- is the 6-arg signature, is_preview_workspace_member(uuid) exists + is granted
-- to `authenticated`, storage.foldername exists, captures bucket absent. pg_cron
-- is NOT installed on this project, so the orphan-cleanup is NOT auto-scheduled —
-- the purge function is provided and can be scheduled once pg_cron is enabled.
-- =============================================================================

-- 1. Private bucket with server-enforced size + mime caps --------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'captures', 'captures', false,
  10485760,                                     -- 10 MiB / object
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do nothing;

-- 2. RLS: UPLOAD — only a caller with a live review session for that preview ---
-- Covers both guests and members-reviewing (both hold an anon session row).
create policy "captures upload within active review session"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'captures'
    and exists (
      select 1
      from public.review_sessions rs
      where rs.anon_user_id = (select auth.uid())
        and rs.preview_id::text = (storage.foldername(name))[1]
        and rs.expires_at > now()
    )
  );

-- 3. RLS: READ — the reviewer (active session) OR a workspace member (dashboard).
create policy "captures read within session or as workspace member"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'captures'
    and (
      exists (
        select 1
        from public.review_sessions rs
        where rs.anon_user_id = (select auth.uid())
          and rs.preview_id::text = (storage.foldername(name))[1]
          and rs.expires_at > now()
      )
      or exists (
        select 1
        from public.previews p
        where p.id::text = (storage.foldername(name))[1]
          and public.is_preview_workspace_member(p.id)
      )
    )
  );

-- No UPDATE/DELETE policies: reviewers create-only (first-writer-wins on the uuid
-- path); deletion happens via the cleanup function below, which runs as its owner.

-- 4. Orphan cleanup — previews cascade-delete their comments but NOT their
--    storage objects, so purge captures whose preview no longer exists. Mirrors
--    the 0021 pg_cron approach.
create or replace function public.purge_orphaned_captures()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from storage.objects o
  where o.bucket_id = 'captures'
    and not exists (
      select 1 from public.previews p
      where p.id::text = (storage.foldername(o.name))[1]
    );
end;
$$;

revoke all on function public.purge_orphaned_captures() from public;

-- Scheduling: pg_cron is NOT installed on this project, so we do not schedule the
-- purge here (a bare `cron.schedule` would fail). Once pg_cron is enabled, run:
--   select cron.schedule('purge-orphaned-captures', '17 4 * * *',
--     $$select public.purge_orphaned_captures();$$);
-- Until then, purge_orphaned_captures() can be invoked manually / from a job.
