'use client';

import { useEffect, useState } from 'react';

import { Switch } from '@/components/switch';
import {
  INCLUDE_SOURCE_DEFAULT,
  readIncludeSourcePref,
  writeIncludeSourcePref,
} from '@/lib/comments/handoff';

/**
 * Enhanced code context panel (R10). Auto-detects whether the customer's preview
 * build is feeding exact file:line — i.e. whether any recent comment carries
 * `context.react.sourceFile` (stamped by @supercomment/source-stamp, U5) — shows
 * the one-time setup steps when it isn't, and owns the per-preview "include
 * file:line in AI hand-offs" preference (localStorage, default ON) that gates the
 * source location attached to the "Send to Claude" hand-off.
 *
 * `detected` is computed server-side from the preview's comments and passed in;
 * the toggle is the only client-owned state (no DB migration — a lightweight
 * client preference keyed by previewId).
 */
export function EnhancedContext({
  previewId,
  detected,
}: {
  previewId: string;
  detected: boolean;
}) {
  // Start from the default so the server render and the first client render
  // match, then sync the persisted preference once mounted (no hydration
  // mismatch — localStorage is read in an effect, never during render).
  const [includeSource, setIncludeSource] = useState(INCLUDE_SOURCE_DEFAULT);
  useEffect(() => {
    setIncludeSource(readIncludeSourcePref(previewId));
  }, [previewId]);

  function toggle(next: boolean) {
    setIncludeSource(next);
    writeIncludeSourcePref(previewId, next);
  }

  return (
    <section className="panel">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <h2 className="panel-title" style={{ marginBottom: 0 }}>
          Enhanced code context
        </h2>
        <span className={detected ? 'badge is-member' : 'badge'}>
          {detected ? 'Detected ✓' : 'Not detected'}
        </span>
      </div>

      <p className="panel-sub" style={{ marginTop: 6 }}>
        {detected
          ? 'Comments on this preview include the exact source file:line of the element a reviewer clicked, so the AI hand-off points straight at the code.'
          : 'Comments capture a component path. Add the optional build plugin to also capture exact file:line for the element a reviewer clicks.'}
      </p>

      {!detected && (
        <div className="context-panel" style={{ marginTop: 0 }}>
          <ol
            style={{
              margin: 0,
              paddingLeft: '1.25rem',
              display: 'grid',
              gap: 6,
              color: 'var(--ink-2)',
            }}
          >
            <li>
              Install the dev plugin: <code>npm i -D @supercomment/source-stamp</code>
            </li>
            <li>
              Enable it for preview builds only in <code>babel.config.js</code> (gate on{' '}
              <code>NEXT_PUBLIC_VERCEL_ENV === &quot;preview&quot;</code>).
            </li>
            <li>
              Strip the attribute in production via{' '}
              <code>compiler.reactRemoveProperties</code> in <code>next.config.ts</code>.
            </li>
          </ol>
          <p className="panel-row-hint" style={{ marginTop: 2 }}>
            Full steps: <code>docs/embed/install.md</code> → “Enhanced code context (optional)”.
            Detection turns on automatically once a stamped comment arrives.
          </p>
        </div>
      )}

      <div className="panel-rows" style={{ marginTop: 6 }}>
        <div className="panel-row">
          <div>
            <div className="panel-row-label">Include file:line in AI hand-offs</div>
            <p className="panel-row-hint">
              When on, the exact source location is attached to a comment when you send it to
              Claude.
              {detected ? '' : ' Takes effect once enhanced context is detected.'}
            </p>
          </div>
          <Switch
            checked={includeSource}
            onChange={toggle}
            label="Include file:line in AI hand-offs"
          />
        </div>
      </div>
    </section>
  );
}
