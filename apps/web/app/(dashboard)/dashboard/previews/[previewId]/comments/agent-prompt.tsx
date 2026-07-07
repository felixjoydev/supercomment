'use client';

import { useState } from 'react';

import { containsSecret } from '@supercomment/shared';
import { createClient } from '@/lib/supabase/client';
import type { CommentView } from '@/lib/comments/types';
import { canShowAgentPrompt, saveAgentPrompt } from '@/lib/comments/agent-prompt';

/**
 * Member-only "prompt to the agent" editor (U4): a private, per-comment
 * instruction that ADDS TO (never replaces) the reply thread. Visually and
 * behaviorally distinct from CommentThread, which any guest can read and post
 * to — this block is gated on `canMutate` and rendered nowhere at all
 * otherwise (R2). Any workspace member may create or edit it (R3); saving
 * clears it when the body is empty (set_agent_prompt's delete semantics,
 * 0043_agent_prompt.sql).
 *
 * Shape mirrors GuestEmail exactly: local editing/value/busy/error state, a
 * direct createClient().rpc() call (via the injectable saveAgentPrompt
 * wrapper), and onLocalUpdate to keep the parent's optimistic list in sync.
 * The one addition is a non-blocking secret-shaped-text warning: detection
 * only (containsSecret), never redaction — the member author is trusted and
 * the body is always saved VERBATIM.
 */
export function AgentPrompt({
  comment,
  canMutate,
  onLocalUpdate,
}: {
  comment: CommentView;
  canMutate: boolean;
  onLocalUpdate: (updated: CommentView) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(comment.privatePrompt?.body ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warn, setWarn] = useState(false);

  if (!canShowAgentPrompt(canMutate)) return null;

  async function save() {
    setBusy(true);
    setError(null);
    const result = await saveAgentPrompt(createClient(), comment.id, value);
    setBusy(false);
    if (!result.ok) {
      setError('Could not save the prompt.');
      return;
    }
    // Detection-only: the body above was saved UNCHANGED regardless of this —
    // never block the save, never redact a member's own prompt.
    setWarn(containsSecret(value));
    onLocalUpdate({ ...comment, privatePrompt: result.prompt });
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="agent-prompt is-editing">
        <label className="agent-prompt-label" htmlFor={`agent-prompt-${comment.id}`}>
          Prompt to the agent <span className="agent-prompt-hint">(member-only, private)</span>
        </label>
        <textarea
          id={`agent-prompt-${comment.id}`}
          className="input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="An instruction only the agent will see…"
          disabled={busy}
          rows={3}
          autoFocus
        />
        <span className="agent-prompt-actions">
          <button type="button" className="text-btn" onClick={() => void save()} disabled={busy}>
            {busy ? 'Saving' : 'Save'}
          </button>
          <button
            type="button"
            className="text-btn"
            onClick={() => {
              setEditing(false);
              setValue(comment.privatePrompt?.body ?? '');
              setError(null);
            }}
            disabled={busy}
          >
            Cancel
          </button>
        </span>
        {warn ? (
          <span className="msg msg-warn">
            This looks like it might contain a secret or credential.
          </span>
        ) : null}
        {error ? <span className="msg msg-err">{error}</span> : null}
      </div>
    );
  }

  return (
    <div className="agent-prompt">
      <span className="agent-prompt-label">
        Prompt to the agent <span className="agent-prompt-hint">(member-only, private)</span>
      </span>
      {comment.privatePrompt ? (
        <>
          <p className="agent-prompt-body">{comment.privatePrompt.body}</p>
          <span className="agent-prompt-byline">
            added by {comment.privatePrompt.authorDisplayName}
          </span>
        </>
      ) : (
        <span className="agent-prompt-none">No prompt to the agent yet.</span>
      )}
      <button
        type="button"
        className="text-btn"
        onClick={() => {
          setValue(comment.privatePrompt?.body ?? '');
          setWarn(false);
          setError(null);
          setEditing(true);
        }}
        title="Add a private instruction for the agent"
      >
        {comment.privatePrompt ? 'Edit prompt' : 'Add prompt'}
      </button>
    </div>
  );
}
