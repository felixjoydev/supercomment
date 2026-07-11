-- =============================================================================
-- 0047_capture_member_upload.sql — dashboard-member uploads to `captures`
-- =============================================================================
-- The 0027 captures bucket has ONE insert policy — "captures upload within
-- active review session" — which authorizes an upload only when the caller holds
-- an unexpired review_sessions row for the folder's preview. That fits the
-- OVERLAY (reviewers + members-reviewing both hold an anon session row), but a
-- workspace member acting from the DASHBOARD authenticates as their REAL user
-- (auth.uid() = the member), has NO review_sessions row, and therefore cannot
-- upload at all today.
--
-- The image-attachment surfaces (comment_replies.image_refs, 0048; and the
-- member-only agent_prompts.image_refs, 0049) need a dashboard member to upload
-- an image. This migration adds a SECOND, additive INSERT policy that authorizes
-- a member exactly the way the 0027/0032 READ policy already does — via
-- is_capture_workspace_member(<leading path segment>) (0032), which resolves the
-- folder's previewId to its workspace and checks membership on auth.uid().
--
-- Storage RLS policies are OR-ed, so this only WIDENS who may insert; the
-- session policy is untouched (the overlay upload path is unaffected). No
-- UPDATE/DELETE policy is added, preserving 0027's first-writer-wins on the uuid
-- object path. The bucket's server-side file_size_limit + allowed_mime_types
-- still cap size/type for every writer.
--
-- SCOPING PROOF (no cross-workspace write): the leading path segment IS the
-- previewId; is_capture_workspace_member(seg) is true only when a preview with
-- id = seg exists AND is_preview_workspace_member(that preview) — i.e. the caller
-- belongs to that preview's workspace. Writing into another workspace's preview
-- folder requires membership there, which the predicate denies. A malformed
-- segment matches no preview → denied.
--
-- REAL-ENV GATE (cannot run in the sandbox — validate against live Supabase in a
-- ROLLED-BACK txn before push): with member impersonation, an upload INTO an
-- own-workspace preview folder is allowed and INTO a foreign preview folder is
-- denied; an overlay-session upload still works; get_advisors(security) clean.
-- =============================================================================

drop policy if exists "captures upload as workspace member" on storage.objects;
create policy "captures upload as workspace member"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'captures'
    and public.is_capture_workspace_member((storage.foldername(name))[1])
  );
