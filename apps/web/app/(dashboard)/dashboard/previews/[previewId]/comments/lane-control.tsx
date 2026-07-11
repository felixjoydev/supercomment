'use client';

import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';

import type { CommentLane } from '@supercomment/shared';
import type { CommentView } from '@/lib/comments/types';
import { laneLabel } from '@/lib/comments/labels';
import { createClient } from '@/lib/supabase/client';

const spring = { type: 'spring', duration: 0.4, bounce: 0 } as const;

/** The three open lanes the card control moves between (Done/Dismiss live in LifecycleControls). */
const OPEN_LANES: CommentLane[] = ['backlog', 'ready_for_agent', 'in_review'];

/**
 * Per-card lane control (U9) — the click/keyboard way to move a comment through
 * the pipeline. The board's drag is the pointer way; this is the always-present
 * fallback (fully operable without a mouse). Renders only for a member on an
 * OPEN comment. "Ready for agent" is gated by the send-to-agent grant, and
 * moving a reviewer-authored comment there goes through the same confirm step
 * the retired Send button used. Moves are optimistic with rollback via
 * onLocalUpdate; the set_comment_lane RPC re-enforces every gate server-side.
 */
export function LaneControl({
  comment,
  canMutate,
  canSendToAgent,
  onLocalUpdate,
}: {
  comment: CommentView;
  canMutate: boolean;
  canSendToAgent: boolean;
  onLocalUpdate: (updated: CommentView) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<CommentLane | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!canMutate || comment.status !== 'open') return null;

  const current = comment.lane;

  async function move(target: CommentLane, confirmGuest = false) {
    // A reviewer-authored comment moving to Ready for agent is untrusted to the
    // agent (§4) — surface the confirm step first.
    if (target === 'ready_for_agent' && comment.trustLevel === 'guest' && !confirmGuest) {
      setConfirming(true);
      return;
    }
    setBusy(target);
    setError(null);
    const original = comment;
    onLocalUpdate({ ...comment, lane: target }); // optimistic
    const { error: rpcError } = await createClient().rpc('set_comment_lane', {
      p_comment_id: comment.id,
      p_lane: target,
      p_confirm_guest: confirmGuest,
    });
    setBusy(null);
    if (rpcError) {
      onLocalUpdate(original); // rollback
      setError(rpcError.message || 'Could not move. Try again.');
      return;
    }
    setConfirming(false);
  }

  return (
    <div className="lane-control">
      <span className="lane-control-label">Lane</span>
      <div className="lane-chips" role="group" aria-label="Move comment to lane">
        {OPEN_LANES.map((lane) => {
          const isCurrent = lane === current;
          const blocked = lane === 'ready_for_agent' && !canSendToAgent;
          return (
            <button
              key={lane}
              type="button"
              className={isCurrent ? 'lane-chip is-current' : 'lane-chip'}
              aria-pressed={isCurrent}
              disabled={isCurrent || blocked || busy != null}
              title={
                blocked ? 'You do not have permission to send to the agent' : undefined
              }
              onClick={() => void move(lane)}
            >
              {laneLabel(lane)}
            </button>
          );
        })}
      </div>

      <AnimatePresence initial={false}>
        {confirming ? (
          <motion.div
            key="confirm"
            className="lane-confirm"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={spring}
            style={{ overflow: 'hidden' }}
          >
            <span className="lane-confirm-text">
              This comment is from a reviewer and is untrusted to the agent.
              Confirm you want to send it.
            </span>
            <span className="lane-confirm-actions">
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => void move('ready_for_agent', true)}
                disabled={busy != null}
              >
                Confirm &amp; send
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setConfirming(false)}
                disabled={busy != null}
              >
                Cancel
              </button>
            </span>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {error ? (
        <p className="msg msg-err" style={{ fontSize: 12, margin: '2px 0 0' }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
