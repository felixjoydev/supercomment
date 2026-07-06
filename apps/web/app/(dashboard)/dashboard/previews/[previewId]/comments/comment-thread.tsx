'use client';

import { useEffect, useState } from 'react';

import { createClient } from '@/lib/supabase/client';

/** One reply as read from `comment_replies` (0033); author name/trust denormalized. */
interface Reply {
  id: string;
  author_display_name: string;
  trust_level: string;
  body: string;
  created_at: string;
}

/**
 * The reply thread under a dashboard comment (0033): loads replies, lets a member
 * reply, and lets a member delete their OWN reply. Whole-thread deletion lives on
 * the card (owner-only). Every write goes through the SECURITY DEFINER RPCs, which
 * re-check permissions server-side, so the client checks are only for affordances.
 *
 * Live: the board bumps `latestReplyAt` when a reply broadcast arrives, so this
 * component re-fetches its replies then — a reply from another member appears in
 * an already-open thread without a page refresh.
 *
 * VERIFY IN REAL ENV: the live Supabase reads/RPCs need a member session.
 */
export function CommentThread({
  commentId,
  latestReplyAt = null,
  onReplied,
}: {
  commentId: string;
  /**
   * Newest reply timestamp for this thread, from the board. A change (a reply
   * broadcast, or the newest reply deleted) re-fetches the reply list so it stays
   * live in an open thread.
   */
  latestReplyAt?: string | null;
  /**
   * Called after THIS viewer posts a reply, with the reply's timestamp, so the
   * card can mark the thread read up to it — otherwise the viewer's own reply
   * broadcast would re-flag their own thread unread.
   */
  onReplied?: (replyAt: string | null) => void;
}) {
  const [replies, setReplies] = useState<Reply[] | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Identity is loaded once — it does not change while the card is mounted.
  useEffect(() => {
    let active = true;
    void createClient()
      .auth.getUser()
      .then(({ data }) => {
        if (active) setEmail(data.user?.email ?? null);
      });
    return () => {
      active = false;
    };
  }, []);

  // Load replies on mount AND whenever the board signals a reply change for this
  // thread (latestReplyAt), so another member's reply shows without a refresh.
  useEffect(() => {
    let active = true;
    void createClient()
      .from('comment_replies')
      .select('id,author_display_name,trust_level,body,created_at')
      .eq('comment_id', commentId)
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        if (active) setReplies((data as Reply[] | null) ?? []);
      });
    return () => {
      active = false;
    };
  }, [commentId, latestReplyAt]);

  async function send() {
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    setError(null);
    const { data, error: e } = await createClient().rpc('create_review_reply', {
      p_comment_id: commentId,
      p_body: body,
    });
    setBusy(false);
    if (e) {
      setError(e.message || 'Could not send. Try again.');
      return;
    }
    const row = (Array.isArray(data) ? data[0] : data) as Reply | undefined;
    if (row) setReplies((r) => [...(r ?? []), row]);
    setText('');
    // Replying implies reading: mark the parent read up to this reply so the
    // incoming reply broadcast doesn't re-flag the viewer's own thread unread.
    onReplied?.(row?.created_at ?? null);
  }

  async function del(id: string) {
    const { error: e } = await createClient().rpc('delete_review_reply', {
      p_reply_id: id,
    });
    if (!e) setReplies((r) => (r ?? []).filter((x) => x.id !== id));
  }

  // Own reply (deletable). The RPC enforces authorship regardless of this check.
  const mine = (r: Reply) =>
    r.trust_level === 'member' && !!email && r.author_display_name === email;

  return (
    <div className="thread">
      {replies && replies.length > 0 && (
        <ul className="thread-list">
          {replies.map((r) => (
            <li key={r.id} className="thread-reply">
              <div className="thread-reply-head">
                <span className="thread-reply-author">{r.author_display_name}</span>
                <span className="thread-reply-time"> · {shortTime(r.created_at)}</span>
                {mine(r) && (
                  <button
                    type="button"
                    className="thread-reply-del"
                    onClick={() => void del(r.id)}
                    aria-label="Delete reply"
                  >
                    ×
                  </button>
                )}
              </div>
              <div className="thread-reply-body">{r.body}</div>
            </li>
          ))}
        </ul>
      )}
      <div className="thread-box">
        <textarea
          className="input thread-input"
          rows={1}
          placeholder="Reply"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => void send()}
          disabled={busy || !text.trim()}
        >
          {busy ? '…' : 'Reply'}
        </button>
      </div>
      {error && <p className="msg msg-err">{error}</p>}
    </div>
  );
}

/** Compact relative time ("just now", "5m ago", …). */
function shortTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const sec = Math.round((Date.now() - t) / 1000);
  if (sec < 45) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(t).toLocaleDateString();
}
