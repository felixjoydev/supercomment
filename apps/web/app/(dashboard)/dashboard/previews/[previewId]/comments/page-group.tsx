'use client';

import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';

import type { CommentView } from '@/lib/comments/types';
import type { PageGroup } from '@/lib/comments/view';
import { CommentCard } from './comment-card';

const spring = { type: 'spring', duration: 0.45, bounce: 0 } as const;

/**
 * One page section in the per-page comment index: a collapsible header carrying
 * the page label, an unread red dot when any thread on the page is unread, the
 * comment count, and an "Open page" deep link (U10). Its comments render inside.
 */
export function PageGroupSection({
  group,
  openPageUrl,
  canMutate,
  canSendToAgent,
  onLocalUpdate,
  onLocalRemove,
}: {
  group: PageGroup;
  /** `/s/<slug><path>` deep link, or null for the unparseable "Other" bucket. */
  openPageUrl: string | null;
  canMutate: boolean;
  canSendToAgent: boolean;
  onLocalUpdate: (updated: CommentView) => void;
  onLocalRemove: (id: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <li className="page-group">
      <div className="page-group-head">
        <button
          type="button"
          className="page-group-toggle"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((v) => !v)}
        >
          <motion.span
            aria-hidden="true"
            style={{ display: 'inline-flex' }}
            animate={{ rotate: collapsed ? 0 : 90 }}
            transition={spring}
          >
            <Chevron />
          </motion.span>
          <span className="page-group-label">{group.label}</span>
          {group.hasUnread ? (
            <span
              className="unread-dot"
              title={`${group.unreadCount} unread`}
              aria-label={`${group.unreadCount} unread`}
            />
          ) : null}
          <span className="page-group-count" aria-label={`${group.count} comments`}>
            {group.count}
          </span>
        </button>

        {openPageUrl ? (
          <a
            className="page-group-open"
            href={openPageUrl}
            target="_blank"
            rel="noreferrer"
            title="Open this page in the preview"
          >
            Open page
          </a>
        ) : null}
      </div>

      <AnimatePresence initial={false}>
        {collapsed ? null : (
          <motion.ul
            className="comment-list"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={spring}
            style={{ overflow: 'hidden' }}
          >
            <AnimatePresence initial={false} mode="popLayout">
              {group.comments.map((comment) => (
                <motion.li
                  key={comment.id}
                  layout
                  initial={{ opacity: 0, y: 14, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -8, scale: 0.98 }}
                  transition={spring}
                >
                  <CommentCard
                    comment={comment}
                    canMutate={canMutate}
                    canSendToAgent={canSendToAgent}
                    onLocalUpdate={onLocalUpdate}
                    onLocalRemove={onLocalRemove}
                  />
                </motion.li>
              ))}
            </AnimatePresence>
          </motion.ul>
        )}
      </AnimatePresence>
    </li>
  );
}

function Chevron() {
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
