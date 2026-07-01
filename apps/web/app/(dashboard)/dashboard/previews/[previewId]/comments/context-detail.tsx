'use client';

import { useEffect, useState } from 'react';

import type { CommentView } from '@/lib/comments/types';
import {
  a11yPathLabel,
  appStateLabel,
  environmentLabel,
  interactionTrailLabel,
  networkLabel,
  surfaceLabel,
} from '@/lib/comments/context-summary';
import {
  classifyCaptureRef,
  resolveCaptureSrc,
  type CaptureSigner,
} from '@/lib/comments/capture-ref';
import { createClient } from '@/lib/supabase/client';

/**
 * Inline expandable view of a comment's captured context: the capture-time
 * "before" artifact when one exists, the selector, URL, component path, and
 * best-effort source location. Collapsed by default in the card (the parent
 * animates the reveal).
 */
export function ContextDetail({ comment }: { comment: CommentView }) {
  const ctx = comment.context;

  if (!ctx) {
    return (
      <div className="context-panel" style={{ color: 'var(--ink-3)' }}>
        No captured context.
      </div>
    );
  }

  // Additive summaries (null when the field is absent — e.g. older comments).
  const surface = surfaceLabel(ctx.surface, ctx.viewport);
  const a11y = a11yPathLabel(ctx.a11yTree);
  const actions = interactionTrailLabel(ctx.interactionTrail);
  const network = networkLabel(ctx.networkRequests);
  const storage = appStateLabel(ctx.appState);
  const browser = environmentLabel(ctx.environment);

  return (
    <div className="context-panel">
      {ctx.screenshot && (
        <BeforeArtifact src={ctx.screenshot} number={comment.number} />
      )}

      {surface && <Row label="Surface" value={surface} />}
      {ctx.selector && <Row label="Selector" value={ctx.selector} mono />}
      {ctx.url && <Row label="URL" value={ctx.url} mono />}
      {ctx.react?.componentPath && ctx.react.componentPath.length > 0 && (
        <Row label="Component" value={ctx.react.componentPath.join(' › ')} />
      )}
      {ctx.react?.sourceFile && (
        <Row
          label="Source"
          value={
            ctx.react.sourceLine
              ? `${ctx.react.sourceFile}:${ctx.react.sourceLine}`
              : ctx.react.sourceFile
          }
          mono
        />
      )}
      {a11y && <Row label="A11y" value={a11y} />}
      {ctx.consoleErrors && ctx.consoleErrors.length > 0 && (
        <Row label="Console" value={`${ctx.consoleErrors.length} error(s)`} />
      )}
      {actions && <Row label="Actions" value={actions} />}
      {network && <Row label="Network" value={network} />}
      {storage && <Row label="Storage" value={storage} />}
      {browser && <Row label="Browser" value={browser} mono />}
      {ctx.commit && <Row label="Commit" value={ctx.commit} mono />}
    </div>
  );
}

/**
 * The capture-time "before" artifact (U9, R15) / modified-state screenshot (U13,
 * R17): the targeted element as it looked at comment time.
 *
 * Three source shapes (U7 read-resolution):
 *  - an inline `data:image/*` URL or an http(s) URL → rendered directly;
 *  - a PRIVATE `captures` bucket object PATH (`<previewId>/<uuid>.<ext>`) → signed
 *    on mount into a short-lived URL with the member session (0027 RLS SELECT),
 *    since a bare path in a private bucket is not directly loadable;
 *  - the non-image DOM-snapshot fallback (`data:application/json,…`) or a failed
 *    signing → a compact "snapshot captured" indicator instead of a broken img.
 */
function BeforeArtifact({ src, number }: { src: string; number: number }) {
  const kind = classifyCaptureRef(src);
  // Inline/URL images render immediately; a private-bucket ref is signed on mount.
  const [resolved, setResolved] = useState<string | null>(
    kind === 'image-url' ? src : null,
  );
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    // Re-sync whenever the src/kind changes on a reused instance (the useState
    // initializer only runs once). Inline/URL images resolve to src directly;
    // a private-bucket ref is signed; anything else has no image.
    setFailed(false);
    if (kind === 'image-url') {
      setResolved(src);
      return;
    }
    if (kind !== 'image-ref') {
      setResolved(null);
      return;
    }
    setResolved(null);
    let active = true;
    const signer: CaptureSigner = async (bucket, path) => {
      // VERIFY IN REAL ENV: the signed-URL round-trip (0027 RLS SELECT via the
      // member session) can't run in the sandbox.
      const { data } = await createClient()
        .storage.from(bucket)
        .createSignedUrl(path, 3600);
      return data?.signedUrl ?? null;
    };
    void resolveCaptureSrc(src, signer).then((url) => {
      if (!active) return;
      if (url) setResolved(url);
      else setFailed(true);
    });
    return () => {
      active = false;
    };
  }, [src, kind]);

  const showImage =
    (kind === 'image-url' || kind === 'image-ref') && !!resolved && !failed;
  const showLoading = kind === 'image-ref' && !resolved && !failed;

  return (
    <figure className="context-before">
      <figcaption className="context-before-cap">Before · at comment time</figcaption>
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={resolved as string}
          alt={`Captured “before” for comment ${number}`}
          className="context-shot"
        />
      ) : showLoading ? (
        <span className="context-snapshot" role="img" aria-label="Loading screenshot">
          <SnapshotGlyph />
          Loading screenshot…
        </span>
      ) : (
        <span
          className="context-snapshot"
          role="img"
          aria-label="DOM snapshot captured at comment time"
        >
          <SnapshotGlyph />
          Snapshot captured at comment time
        </span>
      )}
    </figure>
  );
}

function SnapshotGlyph() {
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

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="context-row">
      <span className="context-label">{label}</span>
      <span className={mono ? 'context-value is-mono' : 'context-value'}>{value}</span>
    </div>
  );
}
