'use client';

import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';

import type { CommentView } from '@/lib/comments/types';
import { severityLabel, intentLabel, trustLabel, statusLabel } from '@/lib/comments/labels';
import { ContextDetail } from './context-detail';
import { LifecycleControls } from './lifecycle-controls';
import { SendToClaudeButton } from './send-to-claude-button';

const spring = { type: 'spring', duration: 0.45, bounce: 0 } as const;

/**
 * A single comment in the review list: serif number chip, severity ribbon,
 * intent + trust (guest vs member) badges, the note, an expandable captured-
 * context block, lifecycle controls (owner/dev only), and Send-to-Claude.
 */
export function CommentCard({
  comment,
  canMutate,
  onLocalUpdate,
}: {
  comment: CommentView;
  canMutate: boolean;
  onLocalUpdate: (updated: CommentView) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const resolved = comment.status === 'resolved';
  const dismissed = comment.status === 'dismissed';
  const muted = resolved || dismissed;

  const cardClass = [
    'comment-card',
    `sev-${comment.severity}`,
    muted ? 'is-muted' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <article className={cardClass}>
      <div className="comment-head">
        <span className="comment-num" aria-label={`Comment number ${comment.number}`}>
          {comment.number}
        </span>

        <div className="comment-body">
          <div className="badges">
            <span className={`badge sev-${comment.severity}`}>
              {severityLabel(comment.severity)}
            </span>
            <span className="badge">{intentLabel(comment.intent)}</span>
            <span className={comment.trustLevel === 'guest' ? 'badge is-guest' : 'badge is-member'}>
              {trustLabel(comment.trustLevel)}
            </span>
            {comment.fidelity === 'snapshot' && <span className="badge is-snapshot">Snapshot</span>}
            {muted && <span className="badge">{statusLabel(comment.status)}</span>}
          </div>

          <p className={dismissed ? 'comment-note is-dismissed' : 'comment-note'}>
            {comment.note}
          </p>

          <div className="comment-byline">
            {comment.author ?? 'Unknown'} · {comment.path ?? '—'}
          </div>

          {muted && comment.resolvedSummary && (
            <p className="comment-outcome">
              {resolved ? 'Resolution: ' : 'Reason: '}
              {comment.resolvedSummary}
            </p>
          )}

          <div className="comment-toolbar">
            <button
              type="button"
              className="text-btn"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
            >
              <motion.span
                aria-hidden="true"
                style={{ display: 'inline-flex' }}
                animate={{ rotate: expanded ? 90 : 0 }}
                transition={spring}
              >
                <ChevronIcon />
              </motion.span>
              Context
            </button>

            {comment.status === 'open' && (
              <SendToClaudeButton comment={comment} canMutate={canMutate} />
            )}
          </div>

          <AnimatePresence initial={false}>
            {expanded ? (
              <motion.div
                key="context"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={spring}
                style={{ overflow: 'hidden' }}
              >
                <ContextDetail comment={comment} />
              </motion.div>
            ) : null}
          </AnimatePresence>

          {canMutate && comment.status === 'open' && (
            <LifecycleControls comment={comment} onLocalUpdate={onLocalUpdate} />
          )}
        </div>
      </div>
    </article>
  );
}

function ChevronIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path
        d="M4.5 2.5L8 6L4.5 9.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
