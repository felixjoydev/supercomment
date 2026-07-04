'use client';

import { useState } from 'react';

import { createClient } from '@/lib/supabase/client';
import type { CommentView } from '@/lib/comments/types';

/**
 * Guest email display + member-only inline edit (U8). Guests identify by an
 * unverified email; a member can correct a typo, and set_participant_email (0036)
 * re-points the guest's read receipts to the new address as an identity merge.
 * Only rendered for guest-authored comments on the member-only dashboard.
 */
export function GuestEmail({
  comment,
  canMutate,
  onLocalUpdate,
}: {
  comment: CommentView;
  canMutate: boolean;
  onLocalUpdate: (updated: CommentView) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(comment.authorEmail ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!comment.authorParticipant) return;
    setBusy(true);
    setError(null);
    const { error: rpcError } = await createClient().rpc('set_participant_email', {
      p_participant_id: comment.authorParticipant,
      p_email: value,
    });
    setBusy(false);
    if (rpcError) {
      setError('Could not save. Check the email address.');
      return;
    }
    onLocalUpdate({ ...comment, authorEmail: value.trim().toLowerCase() });
    setEditing(false);
  }

  if (editing) {
    return (
      <span className="guest-email is-editing">
        <input
          className="input input-inline"
          type="email"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="client@example.com"
          disabled={busy}
          autoFocus
        />
        <button type="button" className="text-btn" onClick={() => void save()} disabled={busy}>
          {busy ? 'Saving' : 'Save'}
        </button>
        <button
          type="button"
          className="text-btn"
          onClick={() => {
            setEditing(false);
            setValue(comment.authorEmail ?? '');
            setError(null);
          }}
          disabled={busy}
        >
          Cancel
        </button>
        {error ? <span className="msg msg-err">{error}</span> : null}
      </span>
    );
  }

  return (
    <span className="guest-email">
      {comment.authorEmail ? (
        <span className="guest-email-value" title="Guest email">
          {comment.authorEmail}
        </span>
      ) : (
        <span className="guest-email-none">no email</span>
      )}
      {canMutate ? (
        <button
          type="button"
          className="text-btn"
          onClick={() => {
            setValue(comment.authorEmail ?? '');
            setEditing(true);
          }}
          title="Fix this guest's email"
        >
          {comment.authorEmail ? 'Edit' : 'Add email'}
        </button>
      ) : null}
    </span>
  );
}
