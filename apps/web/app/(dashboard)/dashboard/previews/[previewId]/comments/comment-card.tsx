'use client';

import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';

import type { CommentView } from '@/lib/comments/types';
import { severityLabel, intentLabel, trustLabel, statusLabel } from '@/lib/comments/labels';
import { createClient } from '@/lib/supabase/client';
import { ContextDetail } from './context-detail';
import { CaptureThumb } from './capture-image';
import { CommentThread } from './comment-thread';
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
  canSendToAgent,
  onLocalUpdate,
  onLocalRemove,
}: {
  comment: CommentView;
  canMutate: boolean;
  /** Phase 2: gates the "Send to agent" button visibility for the current user. */
  canSendToAgent: boolean;
  onLocalUpdate: (updated: CommentView) => void;
  /** Remove the comment from the list after its thread is deleted (owner-only). */
  onLocalRemove: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function deleteThread() {
    setDeleting(true);
    const { error } = await createClient().rpc('delete_review_thread', {
      p_comment_id: comment.id,
    });
    setDeleting(false);
    if (!error) onLocalRemove(comment.id);
    else setConfirmDelete(false);
  }

  /** Mark this thread read/unread for the current member (0037). Optimistic. */
  async function setRead(read: boolean) {
    onLocalUpdate({
      ...comment,
      unread: !read,
      lastReadAt: read ? new Date().toISOString() : null,
    });
    await createClient().rpc(read ? 'mark_thread_read' : 'mark_thread_unread', {
      p_comment_id: comment.id,
    });
  }

  /** Opening the context marks the thread read (Figma-style), on first open. */
  function toggleExpand() {
    const next = !expanded;
    setExpanded(next);
    if (next && comment.unread) void setRead(true);
  }

  const resolved = comment.status === 'resolved';
  const dismissed = comment.status === 'dismissed';
  const muted = resolved || dismissed;

  const cardClass = [
    'comment-card',
    `sev-${comment.severity}`,
    muted ? 'is-muted' : '',
    comment.unread ? 'is-unread' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <article className={cardClass}>
      <div className="comment-head">
        <span className="comment-num" aria-label={`Comment number ${comment.number}`}>
          {comment.number}
        </span>
        {comment.unread ? (
          <span className="unread-dot" title="Unread" aria-label="Unread" />
        ) : null}

        <div className="comment-body">
          <div className="badges">
            <span className={`badge sev-${comment.severity}`}>
              {severityLabel(comment.severity)}
            </span>
            <span className="badge">{intentLabel(comment.intent)}</span>
            <span className={comment.trustLevel === 'guest' ? 'badge is-guest' : 'badge is-member'}>
              {trustLabel(comment.trustLevel)}
            </span>
            {comment.kind === 'template' && (
              <span className="badge is-template" title="A visual edit — carries a change-set">
                <TemplateGlyph />
                Template
              </span>
            )}
            {comment.fidelity === 'snapshot' && <span className="badge is-snapshot">Snapshot</span>}
            {muted && <span className="badge">{statusLabel(comment.status)}</span>}
          </div>

          <p className={dismissed ? 'comment-note is-dismissed' : 'comment-note'}>
            {comment.note}
          </p>

          <div className="comment-byline">
            {comment.author ?? 'Unknown'} · {comment.path ?? '—'}
          </div>

          {comment.context?.screenshot && (
            <CaptureThumb
              src={comment.context.screenshot}
              number={comment.number}
            />
          )}

          {muted && comment.resolvedSummary && (
            <p className="comment-outcome">
              {resolved ? 'Resolution: ' : 'Reason: '}
              {comment.resolvedSummary}
            </p>
          )}

          <CommentThread commentId={comment.id} />

          <div className="comment-toolbar">
            <button
              type="button"
              className="text-btn"
              onClick={toggleExpand}
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

            <button
              type="button"
              className="text-btn"
              onClick={() => void setRead(comment.unread)}
              title={comment.unread ? 'Mark this thread read' : 'Mark this thread unread'}
            >
              {comment.unread ? 'Mark read' : 'Mark unread'}
            </button>

            {comment.status === 'open' && (
              <SendToClaudeButton
                comment={comment}
                canMutate={canMutate}
                canSendToAgent={canSendToAgent}
              />
            )}

            {canMutate &&
              (confirmDelete ? (
                <span className="delete-confirm">
                  <button
                    type="button"
                    className="text-btn is-danger"
                    onClick={() => void deleteThread()}
                    disabled={deleting}
                  >
                    {deleting ? 'Deleting…' : 'Confirm delete'}
                  </button>
                  <button
                    type="button"
                    className="text-btn"
                    onClick={() => setConfirmDelete(false)}
                    disabled={deleting}
                  >
                    Cancel
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  className="text-btn is-danger"
                  onClick={() => setConfirmDelete(true)}
                  title="Delete this whole thread (owner only)"
                >
                  Delete
                </button>
              ))}
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

function TemplateGlyph() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
      style={{ marginRight: 3, verticalAlign: '-1px' }}
    >
      <path
        d="M9.4 2.3l2.3 2.3M8.2 3.5 2.6 9.1l-.6 2.9 2.9-.6 5.6-5.6-2.3-2.3z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
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
