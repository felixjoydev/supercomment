'use client';

import { useReducer, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';

import type { CommentView } from '@/lib/comments/types';
import { requiresGuestConfirm } from '@/lib/comments/view';
import {
  sendReducer,
  sendButtonLabel,
  isInFlight,
  sendStateFromQueueStatus,
  type SendState,
} from '@/lib/comments/send-state';
import { readIncludeSourcePref } from '@/lib/comments/handoff';

const spring = { type: 'spring', duration: 0.45, bounce: 0 } as const;

/**
 * Per-comment "Send to Claude" button (R20 + R23).
 *
 * Member comments enqueue directly. GUEST comments are untrusted to the agent:
 * clicking surfaces an explicit confirm step (the pure state machine moves to
 * `confirm_required`); only after confirming does it POST. The server
 * (/api/send-to-claude) independently re-enforces the same gate, so the UI
 * cannot bypass it.
 */
export function SendToClaudeButton({
  comment,
  canMutate,
}: {
  comment: CommentView;
  canMutate: boolean;
}) {
  // Seed from the persisted queue status so a refresh shows Queued/Working/Done
  // rather than resetting to "Send to Claude".
  const initialState: SendState = comment.sendStatus
    ? sendStateFromQueueStatus(comment.sendStatus)
    : 'idle';
  const [state, dispatch] = useReducer(sendReducer, initialState);
  const [error, setError] = useState<string | null>(null);

  if (!canMutate) return null;

  const needsConfirm = requiresGuestConfirm(comment);

  async function enqueue(confirmGuest: boolean) {
    setError(null);
    dispatch({ type: 'request', requiresConfirm: false });
    try {
      const res = await fetch('/api/send-to-claude', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          commentId: comment.id,
          confirmGuest,
          // R10: honor the per-preview "include file:line" toggle (default ON).
          includeSource: readIncludeSourcePref(comment.previewId),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.message || data?.error || `Failed (${res.status})`);
        dispatch({ type: 'failed' });
        return;
      }
      dispatch({ type: 'succeeded' });
    } catch {
      setError('Network error');
      dispatch({ type: 'failed' });
    }
  }

  function onPrimaryClick() {
    if (state === 'confirm_required') return; // handled by confirm UI below
    if (needsConfirm && state === 'idle') {
      dispatch({ type: 'request', requiresConfirm: true });
      return;
    }
    void enqueue(false);
  }

  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <button
          type="button"
          className="btn btn-accent btn-sm"
          onClick={onPrimaryClick}
          disabled={isInFlight(state) || state === 'confirm_required'}
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={state}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              transition={{ type: 'spring', duration: 0.3, bounce: 0 }}
            >
              {sendButtonLabel(state)}
            </motion.span>
          </AnimatePresence>
        </button>
        {needsConfirm && state === 'idle' && (
          <span className="guest-hint">guest — needs confirm</span>
        )}
      </span>

      <AnimatePresence initial={false}>
        {state === 'confirm_required' ? (
          <motion.span
            key="guest-confirm"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={spring}
            style={{ overflow: 'hidden', display: 'block' }}
          >
            <span className="guest-confirm">
              <span>
                This comment is from a <strong>guest</strong> and is untrusted to the agent.
                Confirm you want to send it to Claude.
              </span>
              <span style={{ display: 'inline-flex', gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    dispatch({ type: 'confirm' });
                    void enqueue(true);
                  }}
                >
                  Confirm &amp; send
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => dispatch({ type: 'cancel' })}
                >
                  Cancel
                </button>
              </span>
            </span>
          </motion.span>
        ) : null}
      </AnimatePresence>

      <AnimatePresence initial={false}>
        {error ? (
          <motion.span
            key="err"
            className="msg msg-err"
            style={{ fontSize: 12 }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {error}
          </motion.span>
        ) : null}
      </AnimatePresence>
    </span>
  );
}
