-- =============================================================================
-- 0051_font_uploads.sql — Figma-Grade Edit Mode (U9)
-- =============================================================================
-- A private Storage bucket for reviewer-uploaded FONT FILES. A reviewer can pick
-- a local font in the editor's font picker; the file previews instantly in their
-- own browser (FontFace from the ArrayBuffer) and, at comment SAVE, is uploaded
-- here and referenced by PATH from the change-set op's `font.fileRef` — never
-- inlined (a font binary would blow the guest context cap like a raster would).
-- The agent receives the file only through the MCP signing gate (member or
-- confirmed-guest, exactly like screenshots); OTHER viewers never fetch the bytes
-- (template re-apply degrades to the family name only), so nothing but the
-- uploader's own browser ever parses untrusted font bytes.
--
-- This mirrors the 0027/0031/0032/0047 `captures` bucket. It reuses the two
-- SECURITY DEFINER predicates those migrations already proved out, so BOTH
-- historical RLS lessons carry over for free:
--   * table-reachability (0031): policies call `has_active_review_session(text)`
--     rather than selecting `review_sessions` inline (the invoking role has no
--     grant on that table);
--   * name-shadow (0032): the leading path segment is extracted at the POLICY top
--     level, where `name` unambiguously means `storage.objects.name`, and passed
--     as text into a predicate (never `storage.foldername(previews.name)`).
--
-- TYPE SAFETY: `allowed_mime_types` is inert font formats ONLY. `image/svg+xml`
-- and every xml/html mime are deliberately EXCLUDED — an SVG font is an XML
-- document that can carry script, so admitting it would turn a "font" upload into
-- a stored-XSS channel. The client sniffs magic bytes and sets the true
-- Content-Type (browsers report application/octet-stream for fonts), so a renamed
-- .html/.svg never acquires a font Content-Type and the bucket rejects it.
--
-- VOLUME BOUND (server-enforced): direct-to-Storage POSTs do NOT pass through
-- create_review_comment's rate cap, and any client-side cap is bypassable, so a
-- per-preview OBJECT-COUNT cap is enforced inside each INSERT policy via a
-- SECURITY DEFINER counter (bypasses RLS for an accurate count; SELECT-only, so
-- no policy recursion). The agent-payload cap (2 fonts / change-set) is a
-- separate, higher-layer bound enforced client-side and re-enforced on read.
--
-- No UPDATE/DELETE policy (first-writer-wins on the uuid path, like captures);
-- deletion is via the owner-only orphan purge below.
--
-- REAL-ENV GATE (cannot be exercised in the sandbox — validated against the live
-- supercomment DB in a ROLLED-BACK txn + get_advisors(security) before apply):
--   * bucket creation + file_size_limit / allowed_mime_types enforcement,
--   * INSERT allowed within an active review session / as a workspace member, and
--     REFUSED once the per-preview object cap is reached,
--   * SELECT allowed as a workspace member (the MCP signer's session),
--   * get_advisors(security) clean after apply.
-- Prereqs verified live 2026-07-12: has_active_review_session(text),
-- is_capture_workspace_member(text), storage.foldername(text) all exist; the
-- fonts bucket is absent. pg_cron is NOT installed, so the purge is provided but
-- not auto-scheduled (mirrors 0027).
--
-- APPLIED + validated live 2026-07-12: rolled-back-txn dry run clean, then
-- applied. Post-apply checks: bucket private, 10 MiB, exactly the 4 font mimes;
-- 3 policies; purge_orphaned_fonts revoked from anon+authenticated;
-- fonts_under_object_cap granted only to authenticated. get_advisors(security):
-- 0 ERROR. The one WARN (authenticated may EXECUTE the SECURITY DEFINER
-- fonts_under_object_cap RPC) is the SAME accepted class as the two predicates
-- this migration reuses — the `authenticated` grant is REQUIRED so the INSERT
-- policy's WITH CHECK can call it; the fn only returns a per-preview count<cap
-- boolean and mutates nothing.
-- =============================================================================

-- 1. Private bucket: 10 MiB / object, inert font formats only ------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'fonts', 'fonts', false,
  10485760,                                     -- 10 MiB / object
  array['font/woff2', 'font/woff', 'font/ttf', 'font/otf']
)
on conflict (id) do nothing;

-- 2. Per-preview object-count cap (server-enforced volume bound) ---------------
-- SECURITY DEFINER so the count bypasses RLS (an RLS-filtered count would
-- under-count and let the cap be evaded). SELECT-only: no INSERT, so calling it
-- from an INSERT policy's WITH CHECK cannot recurse.
create or replace function public.fonts_under_object_cap(p_preview_text text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select (
    select count(*)
    from storage.objects o
    where o.bucket_id = 'fonts'
      and (storage.foldername(o.name))[1] = p_preview_text
  ) < 200;
$$;

revoke all on function public.fonts_under_object_cap(text) from public, anon, authenticated;
grant execute on function public.fonts_under_object_cap(text) to authenticated;

-- 3. INSERT — an active review session for the folder's preview, under the cap --
drop policy if exists "fonts upload within active review session" on storage.objects;
create policy "fonts upload within active review session"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'fonts'
    and public.has_active_review_session((storage.foldername(name))[1])
    and public.fonts_under_object_cap((storage.foldername(name))[1])
  );

-- 4. INSERT — a workspace member (dashboard session), under the same cap --------
drop policy if exists "fonts upload as workspace member" on storage.objects;
create policy "fonts upload as workspace member"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'fonts'
    and public.is_capture_workspace_member((storage.foldername(name))[1])
    and public.fonts_under_object_cap((storage.foldername(name))[1])
  );

-- 5. SELECT — the workspace member whose session signs the ref for the agent ----
-- Minimal privilege: no reviewer-session read branch. The uploader previews from
-- the local ArrayBuffer (never a read-back), and other viewers re-apply by family
-- name only, so only the MCP signer (a workspace member) needs to read the bytes.
drop policy if exists "fonts read as workspace member" on storage.objects;
create policy "fonts read as workspace member"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'fonts'
    and public.is_capture_workspace_member((storage.foldername(name))[1])
  );

-- 6. Orphan cleanup — purge fonts whose preview no longer exists ---------------
-- Mirrors purge_orphaned_captures (0027). Owner-only SECURITY DEFINER with no
-- internal auth check, so it must NOT be a callable RPC: revoke from public AND
-- anon AND authenticated (the 0008 grant post-mortem — the default EXECUTE grant
-- reaches anon + authenticated, so revoking from `public` alone is insufficient).
create or replace function public.purge_orphaned_fonts()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from storage.objects o
  where o.bucket_id = 'fonts'
    and not exists (
      select 1 from public.previews p
      where p.id::text = (storage.foldername(o.name))[1]
    );
end;
$$;

revoke all on function public.purge_orphaned_fonts() from public, anon, authenticated;

-- Scheduling: pg_cron is NOT installed on this project, so we do not schedule the
-- purge here. Once pg_cron is enabled, run:
--   select cron.schedule('purge-orphaned-fonts', '23 4 * * *',
--     $$select public.purge_orphaned_fonts();$$);
