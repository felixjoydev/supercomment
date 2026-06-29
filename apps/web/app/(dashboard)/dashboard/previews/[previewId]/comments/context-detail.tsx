'use client';

import type { CommentView } from '@/lib/comments/types';

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

  return (
    <div className="context-panel">
      {ctx.screenshot && (
        <BeforeArtifact src={ctx.screenshot} number={comment.number} />
      )}

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
      {ctx.consoleErrors && ctx.consoleErrors.length > 0 && (
        <Row label="Console" value={`${ctx.consoleErrors.length} error(s)`} />
      )}
    </div>
  );
}

/**
 * The capture-time "before" artifact (U9, R15): the targeted element as it looked
 * when the comment was made — the "before" half of before/after across redeploys.
 *
 * A real raster is an image (a `data:image/*` URL or an image storage ref) and
 * renders inline. The element-subtree DOM snapshot FALLBACK is a non-image data
 * URL (`data:application/json,...`); rather than render a broken `<img>`, it shows
 * a compact "snapshot captured" indicator. (Rendering the snapshot itself as a
 * visual before/after is follow-up work; here it confirms a before was captured.)
 */
function BeforeArtifact({ src, number }: { src: string; number: number }) {
  // Image when it's an image data URL or any non-`data:` ref (a storage URL);
  // a non-image `data:` URL is the DOM-snapshot fallback.
  const isImage = src.startsWith('data:image/') || !src.startsWith('data:');

  return (
    <figure className="context-before">
      <figcaption className="context-before-cap">Before · at comment time</figcaption>
      {isImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={`Captured “before” for comment ${number}`}
          className="context-shot"
        />
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
