'use client';

import { useEffect, useState } from 'react';

import {
  classifyCaptureRef,
  resolveCaptureSrc,
  type CaptureKind,
  type CaptureSigner,
} from '@/lib/comments/capture-ref';
import { createClient } from '@/lib/supabase/client';

/**
 * Resolve a stored `context.screenshot` value into a renderable image URL.
 *
 * Shared by the card thumbnail and the expanded "before" figure so the signing
 * logic (private `captures` bucket path -> short-lived signed URL via the member
 * session, 0027 RLS) lives in ONE place. Inline `data:image/*` URLs resolve
 * directly; the `data:application/json,…` snapshot fallback resolves to no image.
 *
 * VERIFY IN REAL ENV: the signed-URL round-trip needs a live session + Storage.
 */
export function useResolvedCapture(src: string | null | undefined): {
  kind: CaptureKind;
  url: string | null;
  loading: boolean;
  failed: boolean;
} {
  const kind = classifyCaptureRef(src);
  // Inline image URLs are usable immediately; a private-bucket ref is signed on mount.
  const [url, setUrl] = useState<string | null>(
    kind === 'image-url' ? src ?? null : null,
  );
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
    if (kind === 'image-url') {
      setUrl(src ?? null);
      return;
    }
    if (kind !== 'image-ref') {
      setUrl(null);
      return;
    }
    setUrl(null);
    let active = true;
    const signer: CaptureSigner = async (bucket, path) => {
      const { data } = await createClient()
        .storage.from(bucket)
        .createSignedUrl(path, 3600);
      return data?.signedUrl ?? null;
    };
    void resolveCaptureSrc(src, signer).then((resolved) => {
      if (!active) return;
      if (resolved) setUrl(resolved);
      else setFailed(true);
    });
    return () => {
      active = false;
    };
  }, [src, kind]);

  const loading = kind === 'image-ref' && !url && !failed;
  return { kind, url, loading, failed };
}

/**
 * The capture-time screenshot as a compact, click-to-enlarge thumbnail — shown
 * on the comment card itself so a reviewer SEES the "before" without expanding
 * the context. Real images render; the non-image DOM-snapshot fallback shows a
 * small chip (there is no picture to show).
 */
export function CaptureThumb({ src, number }: { src: string; number: number }) {
  const { kind, url, loading, failed } = useResolvedCapture(src);
  const [open, setOpen] = useState(false);

  if (kind === 'none') return null;
  if (kind === 'snapshot' || failed) {
    return (
      <span
        className="capture-chip"
        role="img"
        aria-label="DOM snapshot captured at comment time (no image)"
      >
        <SnapshotGlyph />
        Snapshot only
      </span>
    );
  }
  if (loading || !url) {
    return (
      <span className="capture-chip" role="img" aria-label="Loading screenshot">
        <SnapshotGlyph />
        Loading…
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        className="capture-thumb"
        onClick={() => setOpen(true)}
        aria-label={`Open screenshot for comment ${number}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={`Screenshot captured for comment ${number}`} />
        <span className="capture-thumb-hint" aria-hidden="true">
          <ExpandGlyph />
        </span>
      </button>
      {open && (
        <CaptureLightbox url={url} number={number} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

/** Full-size overlay for a capture; dismiss on backdrop click or Escape. */
export function CaptureLightbox({
  url,
  number,
  onClose,
}: {
  url: string;
  number: number;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="capture-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={`Screenshot for comment ${number}`}
      onClick={onClose}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={`Screenshot captured for comment ${number}`}
        onClick={(e) => e.stopPropagation()}
      />
      <button
        type="button"
        className="capture-lightbox-close"
        onClick={onClose}
        aria-label="Close screenshot"
      >
        ×
      </button>
    </div>
  );
}

export function SnapshotGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect
        x="2"
        y="3"
        width="12"
        height="10"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <circle cx="8" cy="8" r="2.2" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function ExpandGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M6 2H2v4M10 2h4v4M6 14H2v-4M10 14h4v-4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
