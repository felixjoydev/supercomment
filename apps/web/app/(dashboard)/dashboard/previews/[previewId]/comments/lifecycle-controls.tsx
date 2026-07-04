'use client';

import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';

import { createClient } from '@/lib/supabase/client';
import type { CommentView } from '@/lib/comments/types';

const spring = { type: 'spring', duration: 0.45, bounce: 0 } as const;

/**
 * Resolve / dismiss controls — owner/dev only (the parent gates rendering on
 * `canMutate`, and the resolve_comment / dismiss_comment RPCs re-check workspace
 * membership server-side, so a forged client call is still rejected).
 *
 * Resolve takes an optional summary; dismiss takes an optional reason. Both call
 * the U2 SECURITY DEFINER RPCs and optimistically update the local list (the
 * broadcast then confirms it for everyone else).
 *
 * U9 (R16) — persist until explicitly marked done: a comment leaves the
 * actionable set ONLY when it is resolved or dismissed here. Staleness is
 * ORTHOGONAL to status: comments are filtered/grouped by `status` alone (see
 * `lib/comments/view.ts`), so a comment whose element disappeared on a redeploy
 * (`isStale`, but still `open`) stays in the open list and remains fully
 * resolvable — it never silently vanishes on redeploy. The optimistic update
 * spreads the existing comment, so `isStale` is preserved across the transition.
 */
export function LifecycleControls({
  comment,
  onLocalUpdate,
}: {
  comment: CommentView;
  onLocalUpdate: (updated: CommentView) => void;
}) {
  const [mode, setMode] = useState<'idle' | 'resolve' | 'dismiss'>('idle');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(action: 'resolve' | 'dismiss') {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const rpc = action === 'resolve' ? 'resolve_comment' : 'dismiss_comment';
    const arg =
      action === 'resolve'
        ? { p_comment_id: comment.id, p_summary: text }
        : { p_comment_id: comment.id, p_reason: text };

    const { error: rpcError } = await supabase.rpc(rpc, arg);

    setBusy(false);
    if (rpcError) {
      setError(rpcError.message || 'Action failed. Try again.');
      return;
    }

    onLocalUpdate({
      ...comment,
      status: action === 'resolve' ? 'resolved' : 'dismissed',
      resolvedSummary: text || null,
    });
    setMode('idle');
    setText('');
  }

  /**
   * Reopen a resolved/dismissed comment (U9). Uses resolve_review_comment(false),
   * which a workspace member may call; the 0037 status trigger bumps
   * status_changed_at, so reopening re-flags unread for viewers who had read it.
   */
  async function reopen() {
    setBusy(true);
    setError(null);
    const { error: rpcError } = await createClient().rpc('resolve_review_comment', {
      p_comment_id: comment.id,
      p_resolved: false,
    });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message || 'Could not reopen. Try again.');
      return;
    }
    onLocalUpdate({
      ...comment,
      status: 'open',
      resolvedSummary: null,
      statusChangedAt: new Date().toISOString(),
    });
  }

  return (
    <div>
      <div className="comment-toolbar" style={{ marginTop: 4 }}>
        {comment.status === 'open' ? (
          <>
            <button
              type="button"
              className="text-btn"
              onClick={() => setMode(mode === 'resolve' ? 'idle' : 'resolve')}
              disabled={busy}
            >
              Resolve
            </button>
            <button
              type="button"
              className="text-btn"
              onClick={() => setMode(mode === 'dismiss' ? 'idle' : 'dismiss')}
              disabled={busy}
            >
              Dismiss
            </button>
          </>
        ) : (
          <button
            type="button"
            className="text-btn"
            onClick={() => void reopen()}
            disabled={busy}
          >
            {busy ? 'Reopening' : 'Reopen'}
          </button>
        )}
      </div>

      {comment.status === 'open' && comment.isStale && mode === 'idle' && (
        // R16/AE6: a stale comment (element gone on redeploy) stays open and
        // resolvable — surface that the resolve/dismiss path is still available.
        <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--ink-3)' }}>
          This element is no longer on the live preview — you can still mark it done.
        </p>
      )}

      <AnimatePresence initial={false}>
        {mode !== 'idle' ? (
          <motion.div
            key={mode}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={spring}
            style={{ overflow: 'hidden' }}
          >
            <div style={{ display: 'grid', gap: 8, paddingTop: 8 }}>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={
                  mode === 'resolve'
                    ? 'Resolution summary (optional)'
                    : 'Reason for dismissing (optional)'
                }
                rows={2}
                className="input"
                autoFocus
              />
              {error && <p className="msg msg-err">{error}</p>}
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => submit(mode)}
                  disabled={busy}
                >
                  {busy ? 'Saving…' : mode === 'resolve' ? 'Confirm resolve' : 'Confirm dismiss'}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setMode('idle');
                    setText('');
                    setError(null);
                  }}
                  disabled={busy}
                >
                  Cancel
                </button>
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
