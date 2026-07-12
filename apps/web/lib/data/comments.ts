import { createClient } from '@/lib/supabase/server';
import { toCommentView } from '@/lib/comments/transform';
import type { CommentView, CommentRow } from '@/lib/comments/types';
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
    // Shared column list + the participant join for the author display name and
    // email (member dashboard only; email is never sent to guests or the agent).
    .select(`${COMMENT_ROW_COLUMNS}, participants:author_participant(display_name, email_ci)`)
    .eq('preview_id', previewId)
    .order('created_at', { ascending: false })
    .limit(COMMENTS_INITIAL_LOAD_LIMIT);

  if (error) throw error;

  // The comment's workflow LANE (comment_workflow_lane, 0052) rides the row
  // itself (COMMENT_ROW_COLUMNS), so there is no separate queue join anymore —
  // "sent" is now the lane, and toCommentView projects it directly.
  // Bulk sources for thread-aware unread: newest reply per thread + this member's
  // own read receipts (RLS scopes comment_read_state to the caller's member rows).
  // U4: each comment's member-only "prompt to the agent" (agent_prompts, 0043),
  // so an existing prompt shows on the FIRST load, not just after an in-session
  // edit. The table's own RLS (is_preview_workspace_member) scopes this to the
  // caller's previews same as the comments read above — a real signed-in member
  // satisfies it directly, no session-linkage RPC needed (that's get_agent_prompt,
  // for the overlay's anon session, U5's concern).
  // All three are independent preview_id-scoped queries; run them concurrently
  // rather than as sequential round trips (code review finding, performance).
  const [latestReplyByComment, lastReadByComment, promptByComment] =
    await Promise.all([
      getLatestReplyMap(supabase, previewId),
      getReadReceiptMap(supabase, previewId),
      getAgentPromptMap(supabase, previewId),
    ]);

  // The select column list is a runtime string (COMMENT_ROW_COLUMNS), so
  // PostgREST's compile-time select inference can't narrow the row type; we cast
  // to the untyped row bag and normalize via the shared toCommentView anyway.
  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  return rows.map((raw) => {
    const participant = Array.isArray(raw.participants)
      ? (raw.participants as { display_name?: string | null; email_ci?: string | null }[])[0]
      : (raw.participants as { display_name?: string | null; email_ci?: string | null } | null);
    const view = toCommentView(raw as unknown as CommentRow, {
      authorName: participant?.display_name ?? null,
      authorEmail: participant?.email_ci ?? null,
      latestReplyAt: latestReplyByComment.get((raw.id as string) ?? '') ?? null,
      lastReadAt: lastReadByComment.get((raw.id as string) ?? '') ?? null,
    });
    return {
      ...view,
      privatePrompt: promptByComment.get(view.id) ?? null,
    };
  });
}

/** Map each comment id → its newest reply's created_at, for unread derivation. */
async function getLatestReplyMap(
  supabase: Awaited<ReturnType<typeof createClient>>,
  previewId: string,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const { data, error } = await supabase
    .from('comment_replies')
    .select('comment_id, created_at')
    .eq('preview_id', previewId)
    .order('created_at', { ascending: true });
  if (error) return map; // non-critical; unread degrades to root-only
  for (const row of (data ?? []) as { comment_id: string; created_at: string }[]) {
    map.set(row.comment_id, row.created_at); // ascending → last write wins = newest
  }
  return map;
}

/**
 * Map each comment id → the current member's last_read_at. RLS on
 * comment_read_state restricts the rows to the caller's own member receipts, so
 * no other viewer's read state is ever exposed here.
 */
async function getReadReceiptMap(
  supabase: Awaited<ReturnType<typeof createClient>>,
  previewId: string,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const { data, error } = await supabase
    .from('comment_read_state')
    .select('comment_id, last_read_at')
    .eq('preview_id', previewId);
  if (error) return map; // non-critical; degrade to "everything unread"
  for (const row of (data ?? []) as { comment_id: string; last_read_at: string }[]) {
    map.set(row.comment_id, row.last_read_at);
  }
  return map;
}

/**
 * Map each comment id → its private "prompt to the agent" (U4), if any. One row
 * per comment (agent_prompts.comment_id is unique), so there is no ordering
 * concern like the queue map below. Non-critical: a read failure degrades to
 * "no prompt shown" rather than breaking the whole page load.
 */
async function getAgentPromptMap(
  supabase: Awaited<ReturnType<typeof createClient>>,
  previewId: string,
): Promise<Map<string, NonNullable<CommentView['privatePrompt']>>> {
  const map = new Map<string, NonNullable<CommentView['privatePrompt']>>();
  const { data, error } = await supabase
    .from('agent_prompts')
    .select('comment_id, body, author_display_name, image_refs')
    .eq('preview_id', previewId);
  if (error) return map; // non-critical; degrades to "no prompt shown"
  for (const row of (data ?? []) as {
    comment_id: string;
    body: string;
    author_display_name: string;
    image_refs?: string[] | null;
  }[]) {
    map.set(row.comment_id, {
      body: row.body,
      authorDisplayName: row.author_display_name,
      imageRefs: row.image_refs ?? [],
    });
  }
  return map;
}
