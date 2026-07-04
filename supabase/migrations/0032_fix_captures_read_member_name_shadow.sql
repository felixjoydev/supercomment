-- 0032 — fix the captures READ policy's member branch (broken since 0027).
--
-- The member branch was:
--   exists (select 1 from previews p
--           where p.id::text = (storage.foldername(name))[1]
--             and is_preview_workspace_member(p.id))
-- Inside that subquery `name` is AMBIGUOUS — storage.objects.name (the object
-- path we want) vs previews.name (the preview's display name) — and Postgres
-- binds to the innermost range table, so it compiled to
-- `storage.foldername(previews.name)`. That is the preview's TITLE, never a
-- "<previewId>/<uuid>.png" path, so `p.id::text = <title>` is always false and NO
-- workspace member could ever read a capture (the dashboard's createSignedUrl
-- returns 404). This is why captures never displayed, even ones uploaded before
-- the 0030 upload regression.
--
-- Fix: extract the folder at the POLICY top level (where `name` unambiguously
-- means storage.objects.name, since previews is not in scope) and pass it to a
-- SECURITY DEFINER predicate — same shape as has_active_review_session.

create or replace function public.is_capture_workspace_member(p_preview_text text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.previews p
    where p.id::text = p_preview_text
      and public.is_preview_workspace_member(p.id)
  );
$$;

revoke all on function public.is_capture_workspace_member(text) from public;
grant execute on function public.is_capture_workspace_member(text) to authenticated;

drop policy if exists "captures read within session or as workspace member" on storage.objects;
create policy "captures read within session or as workspace member"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'captures'
    and (
      public.has_active_review_session((storage.foldername(name))[1])
      or public.is_capture_workspace_member((storage.foldername(name))[1])
    )
  );
