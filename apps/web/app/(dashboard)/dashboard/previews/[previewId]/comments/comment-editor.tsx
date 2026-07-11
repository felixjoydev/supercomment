'use client';

import { useEffect, useRef, useState } from 'react';

import { isValidCaptureImage } from '@supercomment/shared';
import { createClient } from '@/lib/supabase/client';
import { uploadCapture } from '@/lib/comments/capture-upload';
import type { CommentView } from '@/lib/comments/types';
import { SignedThumb } from './capture-image';

/** A picked-but-not-yet-uploaded reference image: the File plus an object-URL preview. */
interface Pending {
  file: File;
  url: string;
}

/**
 * Inline editor for the author's own comment (0050): note text + reference
 * images (existing removable, new attachable). Author-only + untouched-by-others
 * is enforced by the edit_review_comment RPC; this is only shown when the gate
 * allows it. On save it uploads new images and rewrites note + context images,
 * then hands the updated comment back for the optimistic list.
 */
export function CommentEditor({
  comment,
  onSaved,
  onCancel,
}: {
  comment: CommentView;
  onSaved: (updated: CommentView) => void;
  onCancel: () => void;
}) {
  const [note, setNote] = useState(comment.note);
  const [existingRefs, setExistingRefs] = useState<string[]>(
    comment.context?.referenceImages ?? [],
  );
  const [pending, setPending] = useState<Pending[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    return () => {
      pending.forEach((p) => URL.revokeObjectURL(p.url));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    const body = note.trim();
    if (!body) {
      setError('A comment needs a note.');
      return;
    }
    setBusy(true);
    setError(null);
    const client = createClient();
    const uploaded = (
      await Promise.all(pending.map((p) => uploadCapture(client, comment.previewId, p.file)))
    ).filter((r): r is string => !!r);
    const imageRefs = [...existingRefs, ...uploaded];
    const { error: e } = await client.rpc('edit_review_comment', {
      p_comment_id: comment.id,
      p_note: body,
      p_image_refs: imageRefs,
    });
    setBusy(false);
    if (e) {
      setError('Could not save. It may have been replied to or sent to the agent.');
      return;
    }
    const nextContext = comment.context
      ? { ...comment.context, referenceImages: imageRefs.length > 0 ? imageRefs : undefined }
      : null;
    pending.forEach((p) => URL.revokeObjectURL(p.url));
    onSaved({ ...comment, note: body, context: nextContext as CommentView['context'] });
  }

  return (
    <div className="comment-edit">
      <textarea
        className="input"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Describe what should change…"
        disabled={busy}
        rows={3}
        autoFocus
      />
      {(existingRefs.length > 0 || pending.length > 0) && (
        <div className="thread-compose-thumbs">
          {existingRefs.map((ref) => (
            <div key={ref} className="agent-prompt-thumb-wrap">
              <SignedThumb src={ref} alt="reference image" />
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
            <div key={p.url} className="thread-compose-thumb">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt="Attached image preview" />
              <button
                type="button"
                className="thread-compose-remove"
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
      <div className="comment-edit-actions">
        <button
          type="button"
          className="text-btn"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
        >
          Attach image
        </button>
        <button type="button" className="btn btn-sm" onClick={() => void save()} disabled={busy}>
          {busy ? 'Saving' : 'Save'}
        </button>
        <button type="button" className="text-btn" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
      {error && <p className="msg msg-err">{error}</p>}
    </div>
  );
}
