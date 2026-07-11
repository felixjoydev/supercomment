'use client';

import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  closestCorners,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';

import { createClient } from '@/lib/supabase/client';
import type { CommentView } from '@/lib/comments/types';
import { displayLane, sortForReview } from '@/lib/comments/view';
import { laneLabel, severityLabel } from '@/lib/comments/labels';

const spring = { type: 'spring', duration: 0.4, bounce: 0.15 } as const;

/** The board columns, in pipeline order. Dismissed is NOT a column (§7/§11). */
type BoardColumn = 'backlog' | 'ready_for_agent' | 'in_review' | 'done';
const COLUMNS: BoardColumn[] = ['backlog', 'ready_for_agent', 'in_review', 'done'];

/**
 * Whether the current member may DROP a card into a column (§4 permission
 * matrix). The dashboard is a member surface, so `canMutate` is the baseline;
 * only Ready for agent additionally needs the send-to-agent grant.
 */
function canDropInto(
  column: BoardColumn,
  perms: { canMutate: boolean; canSendToAgent: boolean },
): boolean {
  if (!perms.canMutate) return false;
  if (column === 'ready_for_agent') return perms.canSendToAgent;
  return true;
}

/**
 * Kanban Board view (U8). One column per lane; cards flow within a column
 * sorted by severity then recency. Moving a card is drag-and-drop with an
 * OPTIMISTIC update + rollback: the card jumps immediately and snaps back with
 * a toast if the RPC fails. Drop targets are permission-aware, and moving a
 * reviewer-authored comment to Ready for agent goes through the guest-confirm
 * gate. A keyboard sensor makes the board operable without a mouse; the
 * per-card lane menu (U9) is the always-available click/keyboard fallback.
 *
 * All lane moves call the same RPCs the rest of the app uses (set_comment_lane
 * / resolve_comment / reopen), directly from the authenticated member client.
 */
export function CommentBoardKanban({
  comments,
  canMutate,
  canSendToAgent,
  onLocalUpdate,
}: {
  comments: CommentView[];
  canMutate: boolean;
  canSendToAgent: boolean;
  onLocalUpdate: (updated: CommentView) => void;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<CommentView | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const sensors = useSensors(
    // A small activation distance so a click to expand a card is not swallowed
    // as a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  // Group into columns (dismissed is filtered out — it is not a board column).
  const byColumn = useMemo(() => {
    const map: Record<BoardColumn, CommentView[]> = {
      backlog: [],
      ready_for_agent: [],
      in_review: [],
      done: [],
    };
    for (const c of comments) {
      const dl = displayLane(c);
      if (dl === 'dismissed') continue;
      map[dl as BoardColumn].push(c);
    }
    for (const col of COLUMNS) map[col] = sortForReview(map[col]);
    return map;
  }, [comments]);

  const activeComment = activeId
    ? comments.find((c) => c.id === activeId) ?? null
    : null;

  function showToast(message: string) {
    setToast(message);
    // Auto-dismiss; a later toast replaces this one.
    window.setTimeout(() => setToast((t) => (t === message ? null : t)), 3200);
  }

  /**
   * Apply a move: optimistic local update first, then the RPC. On failure,
   * restore the original card and toast. `confirmGuest` is only meaningful for
   * the Ready-for-agent target and is always the result of an explicit human
   * confirmation (never passed blindly for a reviewer-authored comment).
   */
  async function performMove(
    original: CommentView,
    target: BoardColumn,
    confirmGuest: boolean,
  ) {
    // Optimistic projection of the drop.
    if (target === 'done') {
      onLocalUpdate({ ...original, status: 'resolved' });
    } else {
      onLocalUpdate({
        ...original,
        status: 'open',
        lane: target,
        resolvedSummary: original.status === 'open' ? original.resolvedSummary : null,
      });
    }

    const supabase = createClient();
    try {
      if (target === 'done') {
        const { error } = await supabase.rpc('resolve_comment', {
          p_comment_id: original.id,
          p_summary: '',
        });
        if (error) throw error;
      } else {
        // A card dragged out of Done is reopened first, then lands in its lane.
        if (original.status !== 'open') {
          const { error: reErr } = await supabase.rpc('resolve_review_comment', {
            p_comment_id: original.id,
            p_resolved: false,
          });
          if (reErr) throw reErr;
        }
        const { error } = await supabase.rpc('set_comment_lane', {
          p_comment_id: original.id,
          p_lane: target,
          p_confirm_guest: confirmGuest,
        });
        if (error) throw error;
      }
    } catch {
      onLocalUpdate(original); // rollback
      showToast(`Could not move to ${laneLabel(target)}. Put it back.`);
    }
  }

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;
    const target = over.id as BoardColumn;
    const comment = comments.find((c) => c.id === active.id);
    if (!comment) return;
    if (displayLane(comment) === target) return; // dropped in its own column

    if (!canDropInto(target, { canMutate, canSendToAgent })) {
      showToast(
        target === 'ready_for_agent'
          ? 'You do not have permission to send comments to the agent.'
          : 'You can not move comments there.',
      );
      return;
    }

    // §4: a reviewer-authored comment moving to Ready for agent needs the
    // explicit confirm (it is untrusted to the agent). Route through the modal.
    if (target === 'ready_for_agent' && comment.trustLevel === 'guest') {
      setPendingConfirm(comment);
      return;
    }

    void performMove(comment, target, false);
  }

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        <div className="kanban" role="list" aria-label="Comment board">
          {COLUMNS.map((col) => (
            <Column
              key={col}
              column={col}
              comments={byColumn[col]}
              droppable={canDropInto(col, { canMutate, canSendToAgent })}
              dragging={activeId != null}
            />
          ))}
        </div>

        <DragOverlay dropAnimation={{ duration: 220, easing: 'cubic-bezier(0.2, 0, 0, 1)' }}>
          {activeComment ? (
            <div className="kanban-card is-overlay">
              <KanbanCardContent comment={activeComment} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <AnimatePresence>
        {pendingConfirm ? (
          <ConfirmSendDialog
            comment={pendingConfirm}
            onConfirm={() => {
              const c = pendingConfirm;
              setPendingConfirm(null);
              void performMove(c, 'ready_for_agent', true);
            }}
            onCancel={() => setPendingConfirm(null)}
          />
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {toast ? (
          <motion.div
            className="kanban-toast"
            role="status"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={spring}
          >
            {toast}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}

function Column({
  column,
  comments,
  droppable,
  dragging,
}: {
  column: BoardColumn;
  comments: CommentView[];
  droppable: boolean;
  dragging: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column });
  const cls = [
    'kanban-col',
    isOver && droppable ? 'is-over' : '',
    // While a drag is active, dim columns this user can not drop into.
    dragging && !droppable ? 'is-blocked' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <section ref={setNodeRef} className={cls} role="listitem" aria-label={laneLabel(column)}>
      <header className="kanban-col-head">
        <span className="kanban-col-title">{laneLabel(column)}</span>
        <span className="kanban-col-count">{comments.length}</span>
      </header>
      <div className="kanban-col-body">
        {comments.length === 0 ? (
          <p className="kanban-col-empty">{dragging ? 'Drop here' : 'Nothing here'}</p>
        ) : (
          comments.map((c) => <DraggableCard key={c.id} comment={c} />)
        )}
      </div>
    </section>
  );
}

function DraggableCard({ comment }: { comment: CommentView }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: comment.id,
  });
  return (
    <motion.article
      layout
      transition={spring}
      ref={setNodeRef}
      className={isDragging ? 'kanban-card is-dragging' : 'kanban-card'}
      {...listeners}
      {...attributes}
    >
      <KanbanCardContent comment={comment} />
    </motion.article>
  );
}

function KanbanCardContent({ comment }: { comment: CommentView }) {
  const dl = displayLane(comment);
  return (
    <>
      <div className="kanban-card-top">
        <span className="kanban-card-num">{comment.number}</span>
        <span className={`badge sev-${comment.severity}`}>
          {severityLabel(comment.severity)}
        </span>
        {comment.kind === 'template' && <span className="badge is-template">Template</span>}
        {comment.unread ? <span className="unread-dot" aria-label="Unread" /> : null}
      </div>
      <p className="kanban-card-note">{comment.note}</p>
      {dl === 'in_review' && comment.reviewSummary ? (
        <p className="kanban-card-summary" title="What the agent changed">
          {comment.reviewSummary}
        </p>
      ) : null}
      <div className="kanban-card-foot">
        <span className="kanban-card-page">{comment.path ?? 'no page'}</span>
        <span className="kanban-card-author">{comment.author ?? 'Unknown'}</span>
      </div>
    </>
  );
}

/**
 * Confirm sending a reviewer-authored comment to the agent (§4). Deliberately
 * avoids the word "guest" in the reviewer-facing copy per project preference —
 * here it addresses the member, describing the author as a reviewer.
 */
function ConfirmSendDialog({
  comment,
  onConfirm,
  onCancel,
}: {
  comment: CommentView;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <motion.div
      className="kanban-confirm-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onCancel}
    >
      <motion.div
        className="kanban-confirm"
        role="dialog"
        aria-modal="true"
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={spring}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="kanban-confirm-title">Send to the agent?</p>
        <p className="kanban-confirm-body">
          Comment #{comment.number} is from a reviewer and is untrusted to the agent.
          Confirm you want to hand it off.
        </p>
        <div className="kanban-confirm-actions">
          <button type="button" className="btn btn-accent btn-sm" onClick={onConfirm}>
            Confirm &amp; send
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

