import { createClient } from '@/lib/supabase/server';
import { toCommentView } from '@/lib/comments/transform';
import type { CommentView, CommentRow, SendStatus } from '@/lib/comments/types';
import { COMMENT_ROW_COLUMNS } from '@supercomment/shared';

/**
 * Server-side comment reads for the review dashboard (RLS-scoped). Part of the
 * lib/data barrel.
 */

/**
 * Defensive upper bound on the initial comment fetch. The dashboard then stays
 * live via the realtime broadcast channel, so this only caps the INITIAL
 * historical load — set generously so real review threads (dozens of comments)
 * are always fully loaded, while a pathological preview can't trigger an
 * unbounded query. VERIFY IN REAL ENV: confirm no active preview exceeds this on
 * first load (add pagination before lowering it).
 */
const COMMENTS_INITIAL_LOAD_LIMIT = 500;

/**
 * Initial RLS-scoped comment list for a preview's review dashboard. The browser
 * client then keeps it live via the private broadcast channel (U9 realtime).
 * Joins the authoring participant for a display name. Returns the full set
 * (open + history), newest first, capped at COMMENTS_INITIAL_LOAD_LIMIT; the
 * client picks the default view via selectDefaultView.
 */
export async function getCommentsForPreview(previewId: string): Promise<CommentView[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('comments')
    // Shared column list + the participant join for the author display name.
    .select(`${COMMENT_ROW_COLUMNS}, participants:author_participant(display_name)`)
    .eq('preview_id', previewId)
    .order('created_at', { ascending: false })
    .limit(COMMENTS_INITIAL_LOAD_LIMIT);

  if (error) throw error;

  // Hydrate each comment's latest "Send to Claude" status from comment_queue so
  // the dashboard button reflects the real persisted state on load (Queued /
  // Working / Done) instead of resetting to "Send to Claude" after a refresh.
  // RLS scopes this to the member's previews, same as the comments read above.
  const sendStatusByComment = await getSendStatusMap(supabase, previewId);

  // The select column list is a runtime string (COMMENT_ROW_COLUMNS), so
  // PostgREST's compile-time select inference can't narrow the row type; we cast
  // to the untyped row bag and normalize via the shared toCommentView anyway.
  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  return rows.map((raw) => {
    const participant = Array.isArray(raw.participants)
      ? (raw.participants as { display_name?: string | null }[])[0]
      : (raw.participants as { display_name?: string | null } | null);
    const authorName = participant?.display_name ?? null;
    const view = toCommentView(raw as unknown as CommentRow, authorName);
    return { ...view, sendStatus: sendStatusByComment.get(view.id) ?? null };
  });
}

/**
 * Map each comment id → its most recent comment_queue status for a preview. A
 * comment can have multiple rows over time (re-sends after a terminal state);
 * the newest row wins, so a fresh "pending" supersedes an older "done".
 */
async function getSendStatusMap(
  supabase: Awaited<ReturnType<typeof createClient>>,
  previewId: string,
): Promise<Map<string, SendStatus>> {
  const map = new Map<string, SendStatus>();
  const { data, error } = await supabase
    .from('comment_queue')
    .select('comment_id, status, created_at')
    .eq('preview_id', previewId)
    .order('created_at', { ascending: true });
  if (error) return map; // queue is non-critical; degrade to "never sent"
  for (const row of (data ?? []) as { comment_id: string; status: SendStatus }[]) {
    map.set(row.comment_id, row.status); // ascending order → last write wins
  }
  return map;
}
