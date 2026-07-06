-- 0041 - grant SELECT on comment_replies to authenticated (the missing half of 0033).
--
-- 0033 enabled RLS on comment_replies and added a SELECT POLICY ("replies readable
-- within session or as member") but never GRANTed SELECT to the authenticated role.
-- A policy without the table grant means the role cannot read the table AT ALL:
-- every direct read returned "permission denied for table comment_replies" and the
-- callers fell back to empty. Comments dodged this because they are read via the
-- list_review_comments SECURITY DEFINER RPC (definer bypasses the grant), but
-- replies are read straight from the table by BOTH:
--   - the overlay  (SessionThreadClient.listReplies -> GET /rest/v1/comment_replies)
--   - the dashboard (CommentThread reply load + latest-reply / read-state maps)
-- so reply threads only ever showed the optimistic in-memory copy, vanished on
-- reload, and a reply made on one surface never appeared on the other.
--
-- Grant SELECT only (writes stay behind the 0033 definer RPCs). RLS still restricts
-- WHICH rows are visible: an active review session for the preview, or a workspace
-- member -- exactly the comments visibility, and mirroring comment_read_state's grants.

grant select on public.comment_replies to authenticated;
