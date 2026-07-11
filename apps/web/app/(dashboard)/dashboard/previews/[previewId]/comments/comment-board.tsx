'use client';

import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';

import { createClient } from '@/lib/supabase/client';
import type { CommentView } from '@/lib/comments/types';
import { applyBroadcast, type BroadcastOp } from '@/lib/comments/realtime';
import {
  mergeComment,
  sortForReview,
  filterByLane,
  countByLane,
  countUnread,
  filterUnread,
  groupByPage,
  type LaneFilter,
  type LaneCounts,
} from '@/lib/comments/view';
import { laneLabel } from '@/lib/comments/labels';
import { PageGroupSection } from './page-group';

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
 * U7: the primary filter is now the workflow LANE (Backlog → Ready for agent →
 * In review → Done), not open/history/all. Dismissed is a secondary affordance
 * ("won't do" is not a pipeline stage). The dashboard is a member (team)
 * surface, so labels use the member vocabulary.
 *
 * VERIFY IN REAL ENV: the live websocket round-trip (subscribe, receive a
 * broadcast, status SUBSCRIBED) cannot be exercised in this sandbox; the merge
 * logic it feeds is unit-tested in __tests__/dashboard-realtime.test.ts and the
 * lane filter/projection in __tests__/comment-lanes.test.ts.
 */
export function CommentBoard({
  previewId,
  slug,
  baseUrl = '',
  initialComments,
  canMutate,
  canSendToAgent,
}: {
  previewId: string;
  /** Preview slug for the per-page "Open page" deep link (`/s/<slug><path>`). */
  slug: string;
  /** App origin for the deep link; '' yields a same-origin relative link. */
  baseUrl?: string;
  initialComments: CommentView[];
  canMutate: boolean;
  /** Phase 2: current user may send to the coding agent (gates the send button). */
  canSendToAgent: boolean;
}) {
  const [comments, setComments] = useState<CommentView[]>(initialComments);
  const [laneFilter, setLaneFilter] = useState<LaneFilter>('all');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [connection, setConnection] = useState<'connecting' | 'live' | 'error'>(
    'connecting',
  );

  useEffect(() => {
    const supabase = createClient();
    const topic = `preview:${previewId}`;
    const channel = supabase.channel(topic, { config: { private: true } });

    // One reducer for every delivery on the topic. It distinguishes comment rows
    // from comment_replies rows (0038) by the payload's `table`, so a reply
    // re-flags its parent thread instead of appearing as a phantom card, and it
    // handles DELETE so a thread deleted by one viewer drops from another's board.
    const handle = (op: BroadcastOp) => (msg: { payload?: unknown }) =>
      setComments((current) => applyBroadcast(current, msg.payload, op));

    channel
      .on('broadcast', { event: 'INSERT' }, handle('INSERT'))
      .on('broadcast', { event: 'UPDATE' }, handle('UPDATE'))
      .on('broadcast', { event: 'DELETE' }, handle('DELETE'))
      .subscribe((status: string) => {
        if (status === 'SUBSCRIBED') setConnection('live');
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT')
          setConnection('error');
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [previewId]);

  const visible = useMemo(
    () => filterUnread(sortForReview(filterByLane(comments, laneFilter)), unreadOnly),
    [comments, laneFilter, unreadOnly],
  );
  const groups = useMemo(() => groupByPage(visible), [visible]);
  const counts = useMemo(() => countByLane(comments), [comments]);
  const unreadTotal = useMemo(
    () => countUnread(filterByLane(comments, laneFilter)),
    [comments, laneFilter],
  );

  function openPageUrlFor(key: string): string | null {
    if (!key.startsWith('/')) return null; // the "Other" (unparseable) bucket
    return `${baseUrl.replace(/\/+$/, '')}/s/${slug}${key}`;
  }

  function handleLocalUpdate(updated: CommentView) {
    setComments((current) => mergeComment(current, updated));
  }

  function handleLocalRemove(id: string) {
    setComments((current) => current.filter((c) => c.id !== id));
  }

  return (
    <section>
      <div className="comments-head">
        <LaneTabs filter={laneFilter} onChange={setLaneFilter} counts={counts} />
        <ConnectionIndicator state={connection} />
      </div>

      <div className="comments-subhead">
        <UnreadToggle
          active={unreadOnly}
          count={unreadTotal}
          onToggle={() => setUnreadOnly((v) => !v)}
        />
        {(counts.dismissed > 0 || laneFilter === 'dismissed') && (
          <DismissedToggle
            active={laneFilter === 'dismissed'}
            count={counts.dismissed}
            onToggle={() =>
              setLaneFilter((f) => (f === 'dismissed' ? 'all' : 'dismissed'))
            }
          />
        )}
      </div>

      {groups.length === 0 ? (
        <EmptyState laneFilter={laneFilter} unreadOnly={unreadOnly} />
      ) : (
        <ul className="page-group-list">
          {groups.map((group) => (
            <PageGroupSection
              key={group.key}
              group={group}
              openPageUrl={openPageUrlFor(group.key)}
              canMutate={canMutate}
              canSendToAgent={canSendToAgent}
              onLocalUpdate={handleLocalUpdate}
              onLocalRemove={handleLocalRemove}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function UnreadToggle({
  active,
  count,
  onToggle,
}: {
  active: boolean;
  count: number;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={active ? 'unread-toggle is-active' : 'unread-toggle'}
      onClick={onToggle}
      aria-pressed={active}
    >
      <span className="unread-dot" aria-hidden="true" />
      Unread only{count > 0 ? <span className="seg-count">{count}</span> : null}
    </button>
  );
}

/**
 * Secondary "Dismissed" affordance — the won't-do pile is reachable but is NOT
 * a pipeline lane, so it lives outside the primary segmented control (§11).
 * Toggling it swaps the lane filter to `dismissed` and back to `all`.
 */
function DismissedToggle({
  active,
  count,
  onToggle,
}: {
  active: boolean;
  count: number;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={active ? 'closed-toggle is-active' : 'closed-toggle'}
      onClick={onToggle}
      aria-pressed={active}
    >
      {laneLabel('dismissed')}
      {count > 0 ? <span className="seg-count">{count}</span> : null}
    </button>
  );
}

// The primary lane segmented control. `dismissed` is deliberately absent here —
// it is the secondary DismissedToggle above, per §7/§11.
const LANE_TABS: { key: Exclude<LaneFilter, 'dismissed'>; countKey: keyof LaneCounts }[] = [
  { key: 'all', countKey: 'all' },
  { key: 'backlog', countKey: 'backlog' },
  { key: 'ready_for_agent', countKey: 'ready_for_agent' },
  { key: 'in_review', countKey: 'in_review' },
  { key: 'done', countKey: 'done' },
];

function tabLabel(key: Exclude<LaneFilter, 'dismissed'>): string {
  return key === 'all' ? 'All' : laneLabel(key);
}

function LaneTabs({
  filter,
  onChange,
  counts,
}: {
  filter: LaneFilter;
  onChange: (f: LaneFilter) => void;
  counts: LaneCounts;
}) {
  return (
    <div className="seg" role="tablist" aria-label="Comment lane filter">
      {LANE_TABS.map((tab) => (
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
            {tabLabel(tab.key)}{' '}
            <span className="seg-count">{counts[tab.countKey]}</span>
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

function EmptyState({
  laneFilter,
  unreadOnly,
}: {
  laneFilter: LaneFilter;
  unreadOnly: boolean;
}) {
  if (unreadOnly) {
    return (
      <div className="empty-state">
        <p className="empty-sub">No unread comments. You are all caught up.</p>
      </div>
    );
  }
  if (laneFilter === 'all') {
    return (
      <div className="empty-state">
        <p className="empty-title">All clear</p>
        <p className="empty-sub">
          Share this preview&rsquo;s link with your workspace to start collecting visual feedback.
        </p>
      </div>
    );
  }
  if (laneFilter === 'dismissed') {
    return (
      <div className="empty-state">
        <p className="empty-sub">Nothing dismissed.</p>
      </div>
    );
  }
  return (
    <div className="empty-state">
      <p className="empty-sub">
        No comments in <strong>{laneLabel(laneFilter)}</strong>.
      </p>
    </div>
  );
}
