'use client';

import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';

import { createClient } from '@/lib/supabase/client';
import { toCommentView } from '@/lib/comments/transform';
import type { CommentRow, CommentView } from '@/lib/comments/types';
import {
  mergeComment,
  reconcileUnread,
  selectView,
  countByStatus,
  countUnread,
  filterUnread,
  groupByPage,
  type DashboardFilter,
} from '@/lib/comments/view';
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
 * VERIFY IN REAL ENV: the live websocket round-trip (subscribe, receive a
 * broadcast, status SUBSCRIBED) cannot be exercised in this sandbox; the merge
 * logic it feeds is unit-tested in __tests__/dashboard-realtime.test.ts.
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
  const [filter, setFilter] = useState<DashboardFilter>('open');
  const [unreadOnly, setUnreadOnly] = useState(false);
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
      setComments((current) => {
        const incoming = toCommentView(record);
        // The broadcast carries no read receipt; preserve the viewer's read state
        // for a thread already on screen so a status/reply update never un-reads it.
        const existing = current.find((c) => c.id === incoming.id);
        return mergeComment(
          current,
          existing ? reconcileUnread(existing, incoming) : incoming,
        );
      });
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

  const visible = useMemo(
    () => filterUnread(selectView(comments, filter), unreadOnly),
    [comments, filter, unreadOnly],
  );
  const groups = useMemo(() => groupByPage(visible), [visible]);
  const counts = useMemo(() => countByStatus(comments), [comments]);
  const unreadTotal = useMemo(
    () => countUnread(selectView(comments, filter)),
    [comments, filter],
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
        <FilterTabs filter={filter} onChange={setFilter} counts={counts} />
        <ConnectionIndicator state={connection} />
      </div>

      <div className="comments-subhead">
        <UnreadToggle
          active={unreadOnly}
          count={unreadTotal}
          onToggle={() => setUnreadOnly((v) => !v)}
        />
      </div>

      {groups.length === 0 ? (
        <EmptyState filter={filter} unreadOnly={unreadOnly} />
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

function EmptyState({
  filter,
  unreadOnly,
}: {
  filter: DashboardFilter;
  unreadOnly: boolean;
}) {
  if (unreadOnly) {
    return (
      <div className="empty-state">
        <p className="empty-sub">No unread comments. You are all caught up.</p>
      </div>
    );
  }
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
