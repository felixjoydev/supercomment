'use client';

import { useEffect, useRef, useState } from 'react';

import { containsSecret, isValidCaptureImage } from '@supercomment/shared';
import { createClient } from '@/lib/supabase/client';
import type { CommentView } from '@/lib/comments/types';
import { canShowAgentPrompt, saveAgentPrompt } from '@/lib/comments/agent-prompt';
import { uploadCapture } from '@/lib/comments/capture-upload';
import { SignedThumb } from './capture-image';

/** A picked-but-not-yet-uploaded prompt image: the File plus an object-URL preview. */
interface Pending {
  file: File;
  url: string;
}

/**
 * Member-only "prompt to the agent" editor (U4): a private, per-comment
 * instruction that ADDS TO (never replaces) the reply thread, now with optional
 * image attachments (R19). Visually and behaviorally distinct from
 * CommentThread, which any guest can read and post to — this block is gated on
 * `canMutate` and rendered nowhere at all otherwise (R2). Any workspace member
 * may create or edit it (R3); saving clears it when the body AND images are both
 * empty (set_agent_prompt's delete semantics, 0049).
 *
 * The prompt (and its images) is MEMBER-ONLY: shown here on the dashboard and
 * ridden to the agent as trusted, but NEVER rendered on the guest-readable
 * overlay popover and never broadcast — so "visible to everyone" (which applies
 * to comment/reply images) deliberately does NOT extend to the prompt channel.
 *
 * A non-blocking secret-shaped-text warning is detection only (containsSecret),
 * never redaction — the member author is trusted and the body is saved VERBATIM.
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
  // Already-saved image refs, editable in the composer (a member may remove one).
  const [existingRefs, setExistingRefs] = useState<string[]>(
    comment.privatePrompt?.imageRefs ?? [],
  );
  const [pending, setPending] = useState<Pending[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warn, setWarn] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  // Tracks the FRESHEST comment prop, independent of any in-flight save's
  // closure (code review fix, julik-frontend-races): a realtime broadcast can
  // update other fields (status, unread) on this same comment while save()'s
  // RPC is awaiting, causing a re-render with a new `comment` prop — but the
  // already-running save() still closes over the OLD one. Reading this ref
  // instead of the closure-captured `comment` at merge time keeps that
  // concurrent update from being silently reverted.
  const commentRef = useRef(comment);
  useEffect(() => {
    commentRef.current = comment;
  }, [comment]);

  // Revoke outstanding object-URL previews on unmount (avoid a leak).
  useEffect(() => {
    return () => {
      pending.forEach((p) => URL.revokeObjectURL(p.url));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!canShowAgentPrompt(canMutate)) return null;

  function openEditor() {
    setValue(comment.privatePrompt?.body ?? '');
    setExistingRefs(comment.privatePrompt?.imageRefs ?? []);
    setPending([]);
    setWarn(false);
    setError(null);
    setEditing(true);
  }

  function closeEditor() {
    pending.forEach((p) => URL.revokeObjectURL(p.url));
    setPending([]);
    setEditing(false);
    setError(null);
  }

  function addFiles(files: FileList | null) {
    if (!files) return;
    const next: Pending[] = [];
    for (const file of Array.from(files)) {
      if (!isValidCaptureImage({ type: file.type, size: file.size })) continue;
      next.push({ file, url: URL.createObjectURL(file) });
    }
    if (next.length > 0) setPending((p) => [...p, ...next]);
  }

  async function save() {
    setBusy(true);
    setError(null);
    const client = createClient();
    // Upload any newly-picked images out-of-band → refs (best-effort per image).
    const uploaded = (
      await Promise.all(
        pending.map((p) => uploadCapture(client, comment.previewId, p.file)),
      )
    ).filter((r): r is string => !!r);
    const imageRefs = [...existingRefs, ...uploaded];
    const result = await saveAgentPrompt(client, comment.id, value, imageRefs);
    setBusy(false);
    if (!result.ok) {
      setError('Could not save the prompt.');
      return;
    }
    // Detection-only: the body above was saved UNCHANGED regardless of this —
    // never block the save, never redact a member's own prompt.
    setWarn(containsSecret(value));
    onLocalUpdate({ ...commentRef.current, privatePrompt: result.prompt });
    pending.forEach((p) => URL.revokeObjectURL(p.url));
    setPending([]);
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
        {(existingRefs.length > 0 || pending.length > 0) && (
          <div className="agent-prompt-thumbs">
            {existingRefs.map((ref) => (
              <div key={ref} className="agent-prompt-thumb-wrap">
                <SignedThumb src={ref} alt="prompt image" />
                <button
                  type="button"
                  className="agent-prompt-thumb-remove"
                  onClick={() => setExistingRefs((r) => r.filter((x) => x !== ref))}
                  aria-label="Remove image"
                  disabled={busy}
                >
                  ×
                </button>
              </div>
            ))}
            {pending.map((p) => (
              <div key={p.url} className="agent-prompt-thumb-wrap">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="agent-prompt-pending-img" src={p.url} alt="Attached image preview" />
                <button
                  type="button"
                  className="agent-prompt-thumb-remove"
                  onClick={() => {
                    URL.revokeObjectURL(p.url);
                    setPending((list) => list.filter((x) => x.url !== p.url));
                  }}
                  aria-label="Remove image"
                  disabled={busy}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          hidden
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <span className="agent-prompt-actions">
          <button
            type="button"
            className="text-btn"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
          >
            Attach image
          </button>
          <button type="button" className="text-btn" onClick={() => void save()} disabled={busy}>
            {busy ? 'Saving' : 'Save'}
          </button>
          <button type="button" className="text-btn" onClick={closeEditor} disabled={busy}>
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

  const prompt = comment.privatePrompt;
  return (
    <div className="agent-prompt">
      <span className="agent-prompt-label">
        Prompt to the agent <span className="agent-prompt-hint">(member-only, private)</span>
      </span>
      {prompt ? (
        <>
          {prompt.body ? <p className="agent-prompt-body">{prompt.body}</p> : null}
          {prompt.imageRefs.length > 0 && (
            <div className="agent-prompt-thumbs">
              {prompt.imageRefs.map((ref, i) => (
                <SignedThumb key={`${ref}-${i}`} src={ref} alt="prompt image" />
              ))}
            </div>
          )}
          <span className="agent-prompt-byline">added by {prompt.authorDisplayName}</span>
        </>
      ) : (
        <span className="agent-prompt-none">No prompt to the agent yet.</span>
      )}
      <button
        type="button"
        className="text-btn"
        onClick={openEditor}
        title="Add a private instruction for the agent"
      >
        {prompt ? 'Edit prompt' : 'Add prompt'}
      </button>
    </div>
  );
}
