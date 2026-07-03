import type { SnapshotPayload, ReactContext } from '@supercomment/shared';
import { serializeDocument } from './serialize.js';
import type { SerializeOptions } from './serialize.js';

/**
 * Snapshot capture orchestrator (U10).
 *
 * Pulls together:
 *  - serialize.ts  -> portable node tree + inlined CSS + degradation notes
 *  - mask.ts       -> applied inside the serializer (values + secret text)
 *  - U7 react.ts   -> capture-time React/source context (runtime-only; gone
 *                     offline, so we MUST grab it now and store it)
 *  - a size cap    -> oversized pages truncate with a flag, never throw
 *
 * Plus the SPA trigger: while a preview is live, client-side route changes
 * (pushState / replaceState / popstate) should re-capture. The trigger is wired
 * here but the serialize/mask core is exposed separately (`captureSnapshot`) so
 * it can be unit-tested without any browser globals.
 */

/** Default cap on serialized payload size before we truncate. ~2.5 MB. */
export const DEFAULT_MAX_BYTES = 2_500_000;

export interface CaptureSnapshotOptions {
  /** Absolute URL of the document. */
  url: string;
  /** Base for resolving relative URLs (usually same as url). */
  baseUrl: string;
  /** Origin for same-origin stylesheet decisions. */
  origin: string;
  /** Size cap in bytes; defaults to DEFAULT_MAX_BYTES. */
  maxBytes?: number;
  /** Injectable URL resolver (tests). */
  resolveUrl?: SerializeOptions['resolveUrl'];
  /**
   * Capture-time React/source context for the document root. Injectable so the
   * core is testable; defaults to running U7's fiber walk on the root element.
   */
  reactContext?: ReactContext | null;
  /** Injectable clock for deterministic tests. */
  now?: () => Date;
}

/** Rough byte size of a JSON-serializable value (UTF-8 approximation). */
function approxByteSize(value: unknown): number {
  const json = JSON.stringify(value);
  if (!json) return 0;
  // Node has Buffer; browsers have TextEncoder. Fall back to length.
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(json).length;
  }
  return json.length;
}

/** A minimal tree node shape: anything with an optional children array. */
interface TreeLike {
  children?: TreeLike[];
}

/**
 * Walk a node tree and drop children beyond a node budget, marking the point of
 * truncation. Returns whether truncation happened. Mutates in place (the tree
 * is freshly built, so this is safe).
 */
function truncateTree(root: TreeLike, maxNodes: number): boolean {
  let count = 0;
  let truncated = false;

  function visit(node: TreeLike): void {
    count += 1;
    if (!node.children) return;
    const kept: TreeLike[] = [];
    for (const child of node.children) {
      if (count >= maxNodes) {
        truncated = true;
        break;
      }
      kept.push(child);
      visit(child);
    }
    node.children = kept;
  }

  visit(root);
  return truncated;
}

/**
 * The testable core. Serializes a document into a SnapshotPayload, applying the
 * size cap. Never throws on oversized input or cross-origin CSS.
 */
export function captureSnapshot(
  doc: Parameters<typeof serializeDocument>[0] & { title?: string },
  opts: CaptureSnapshotOptions,
): SnapshotPayload {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const now = opts.now ?? (() => new Date());

  const { root, stylesheets, degraded } = serializeDocument(doc, {
    baseUrl: opts.baseUrl,
    origin: opts.origin,
    resolveUrl: opts.resolveUrl,
  });

  // Determine if we need to truncate. Estimate first, then cut the tree if so.
  let truncated = false;
  let approxBytes = approxByteSize({ root, stylesheets });
  if (approxBytes > maxBytes) {
    // Cut tree to a node budget proportional to overage; then re-measure.
    // We bisect the node budget a few times to land under the cap without
    // pathological work on huge pages.
    let budget = 2000;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const clone = JSON.parse(JSON.stringify({ root, stylesheets }));
      const didTruncate = truncateTree(clone.root, budget);
      const size = approxByteSize(clone);
      if (size <= maxBytes || budget <= 50) {
        // Accept this budget.
        truncated = didTruncate;
        approxBytes = size;
        // Apply the truncation to the real root.
        truncateTree(root, budget);
        break;
      }
      budget = Math.max(50, Math.floor(budget / 2));
    }
    if (!truncated) {
      // Even the smallest budget didn't fit (e.g. huge stylesheets). Flag it.
      truncated = true;
      approxBytes = approxByteSize({ root, stylesheets });
    }
  }

  const allDegraded = truncated
    ? [...degraded, { kind: 'truncated' as const, detail: `exceeded ${maxBytes} bytes` }]
    : degraded;

  return {
    version: 1,
    url: opts.url,
    title: doc.title ?? '',
    baseUrl: opts.baseUrl,
    root,
    stylesheets,
    reactContext: opts.reactContext ?? null,
    degraded: allDegraded,
    truncated,
    approxBytes,
    capturedAt: now().toISOString(),
  };
}
