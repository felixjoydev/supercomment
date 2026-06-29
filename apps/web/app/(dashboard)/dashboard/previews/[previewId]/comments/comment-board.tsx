'use client';

import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';

import { createClient } from '@/lib/supabase/client';
import { toCommentView } from '@/lib/comments/transform';
import type { CommentRow, CommentView } from '@/lib/comments/types';
import {
  mergeComment,
  selectView,
  countByStatus,
  type DashboardFilter,
} from '@/lib/comments/view';
import { CommentCard } from './comment-card';

const spring = { type: 'spring', duration: 0.45, bounce: 0 } as const;

/**
 * Root client island for the realtime comment review surface.
 *
 * Initial list is server-rendered (RLS-scoped) and passed in. We then subscribe
 * to the per-preview PRIVATE broadcast channel `preview:<id>` and merge each
 * delivery through the pure `mergeComment` (insert / update-by-id / dedup). The
 * channel is authorized by the realtime.messages RLS policy from migration 0004
 * — only the preview's workspace members + participants receive its topic.
 *
 * VERIFY IN REAL ENV: the live websocket round-trip (subscribe, receive a
 * broadcast, status SUBSCRIBED) cannot be exercised in this sandbox; the merge
 * logic it feeds is unit-tested in __tests__/dashboard-realtime.test.ts.
 */
export function CommentBoard({
  previewId,
  initialComments,
  canMutate,
}: {
  previewId: string;
  initialComments: CommentView[];
  canMutate: boolean;
}) {
  const [comments, setComments] = useState<CommentView[]>(initialComments);
  const [filter, setFilter] = useState<DashboardFilter>('open');
  const [connection, setConnection] = useState<'connecting' | 'live' | 'error'>(
    'connecting',
  );

  useEffect(() => {
    const supabase = createClient();
    const topic = `preview:${previewId}`;
    const channel = supabase.channel(topic, { config: { private: true } });

    function ingest(payload: unknown) {
      // broadcast_changes delivers { record, old_record, operation, ... }.
      const p = payload as
        | { record?: CommentRow; payload?: { record?: CommentRow } }
        | undefined;
      const record = p?.record ?? p?.payload?.record;
      if (!record || !record.id) return;
      setComments((current) => mergeComment(current, toCommentView(record)));
    }

    channel
      .on('broadcast', { event: 'INSERT' }, (msg: { payload?: unknown }) => ingest(msg.payload))
      .on('broadcast', { event: 'UPDATE' }, (msg: { payload?: unknown }) => ingest(msg.payload))
      .subscribe((status: string) => {
        if (status === 'SUBSCRIBED') setConnection('live');
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT')
          setConnection('error');
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [previewId]);

  const visible = useMemo(() => selectView(comments, filter), [comments, filter]);
  const counts = useMemo(() => countByStatus(comments), [comments]);

  function handleLocalUpdate(updated: CommentView) {
    setComments((current) => mergeComment(current, updated));
  }

  return (
    <section>
      <div className="comments-head">
        <FilterTabs filter={filter} onChange={setFilter} counts={counts} />
        <ConnectionIndicator state={connection} />
      </div>

      {visible.length === 0 ? (
        <EmptyState filter={filter} />
      ) : (
        <ul className="comment-list">
          <AnimatePresence initial={false} mode="popLayout">
            {visible.map((comment) => (
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
                  onLocalUpdate={handleLocalUpdate}
                />
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </section>
  );
}

function FilterTabs({
  filter,
  onChange,
  counts,
}: {
  filter: DashboardFilter;
  onChange: (f: DashboardFilter) => void;
  counts: { open: number; resolved: number; dismissed: number; total: number };
}) {
  const tabs: { key: DashboardFilter; label: string; count: number }[] = [
    { key: 'open', label: 'Open', count: counts.open },
    { key: 'history', label: 'History', count: counts.resolved + counts.dismissed },
    { key: 'all', label: 'All', count: counts.total },
  ];

  return (
    <div className="seg" role="tablist" aria-label="Comment filter">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          aria-selected={filter === tab.key}
          className="seg-btn"
          onClick={() => onChange(tab.key)}
        >
          {filter === tab.key ? (
            <motion.span
              layoutId="comment-filter-pill"
              className="seg-pill"
              transition={spring}
            />
          ) : null}
          <span className="seg-label">
            {tab.label} <span className="seg-count">{tab.count}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

function ConnectionIndicator({ state }: { state: 'connecting' | 'live' | 'error' }) {
  const cls =
    state === 'live'
      ? 'live-indicator is-live'
      : state === 'error'
        ? 'live-indicator is-error'
        : 'live-indicator is-connecting';
  const label = state === 'live' ? 'Live' : state === 'error' ? 'Reconnecting…' : 'Connecting…';
  return (
    <span className={cls}>
      <span className="live-indicator-dot" aria-hidden="true" />
      {label}
    </span>
  );
}

function EmptyState({ filter }: { filter: DashboardFilter }) {
  if (filter === 'open') {
    return (
      <div className="empty-state">
        <p className="empty-title">All clear</p>
        <p className="empty-sub">
          Share this preview&rsquo;s link with your workspace to start collecting visual feedback.
        </p>
      </div>
    );
  }
  return (
    <div className="empty-state">
      <p className="empty-sub">Nothing here yet.</p>
    </div>
  );
}
