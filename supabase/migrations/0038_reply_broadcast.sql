-- 0038 - broadcast reply insert/delete + comment delete on the preview channel.
--
-- Per-viewer unread is recomputed client-side; the shared preview:<id> broadcast
-- only signals "something in this thread changed, recompute". 0004 broadcasts
-- comments INSERT/UPDATE but NOT replies or deletes, so "a new reply re-flags a read
-- thread" and "a deleted thread drops the count" never reached other viewers live.
--
-- We reuse the existing generic public.broadcast_comment_change() (it keys off
-- coalesce(new.preview_id, old.preview_id) + tg_table_name and is best-effort, so a
-- realtime hiccup never blocks the write), inheriting its EXECUTE grants (0010).
-- The dashboard consumer keys the reply payload off comment_id.

create or replace trigger comment_replies_broadcast
  after insert or delete on public.comment_replies
  for each row execute function public.broadcast_comment_change();

-- Complement 0004's comments INSERT/UPDATE trigger with DELETE so a thread deleted by
-- one viewer live-drops from another viewer's board.
create or replace trigger comments_broadcast_delete
  after delete on public.comments
  for each row execute function public.broadcast_comment_change();
