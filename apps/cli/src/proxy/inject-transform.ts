import { Transform, type TransformCallback } from 'node:stream';

/**
 * Boundary-safe HTML injection Transform (U3).
 *
 * Goal: inject a single overlay <script> tag into a streamed/chunked HTML
 * document exactly once, at the best available position, without ever buffering
 * the whole document. SSR streaming (Next.js App Router) and dev servers emit
 * HTML in many chunks, and the marker we look for (`<head ...>`) can be split
 * across a chunk boundary (e.g. "...<he" | "ad>..."). A naive per-chunk string
 * search would miss those splits or inject twice.
 *
 * Injection priority:
 *   1. Immediately after the `<head ...>` open tag (preferred — overlay loads
 *      as the first child of <head>).
 *   2. Else immediately after the `<html ...>` open tag.
 *   3. Else prepend (fragments / malformed docs that slipped past the
 *      content-type gate).
 *
 * Strategy — bounded decision buffer:
 *   - While we have NOT yet injected, we accumulate incoming bytes in a pending
 *     buffer instead of forwarding them, because the injection point might be
 *     anywhere in the early part of the document and could straddle chunk
 *     boundaries. We only need to hold back the *head region* of the document.
 *   - On each chunk we re-scan the pending buffer:
 *       * If `<head ...>` (with its closing '>') is found, inject there, flush
 *         everything, and flip to zero-copy pass-through.
 *       * Else, once the pending buffer has grown past a bounded lookahead
 *         window (DECISION_WINDOW), we know `<head>` is not coming soon. We then
 *         fall back to `<html ...>` if present, otherwise we keep waiting only if
 *         we have not yet seen `<html>` either (it might still arrive). To bound
 *         memory we commit to a decision at the window edge: inject after
 *         `<html>` if seen, else prepend.
 *   - Once injected we become a true pass-through: subsequent bytes are forwarded
 *     unchanged, preserving the original document byte-for-byte apart from the
 *     single inserted tag.
 *   - On flush (stream end) with no injection yet, decide from whatever is
 *     pending: `<head>` → `<html>` → prepend.
 *
 * The pending buffer is bounded by DECISION_WINDOW (a few KB), which is far more
 * than enough to contain `<html><head ...>` for any real document, so we never
 * buffer the document body.
 *
 * Marker scanning uses latin1 so multi-byte UTF-8 is never corrupted: latin1
 * maps each byte 1:1 to a code unit, indices line up exactly with Buffer
 * offsets, and we only ever match ASCII markers, so non-ASCII bytes pass through
 * untouched.
 */

const HEAD_OPEN = '<head';
const HTML_OPEN = '<html';

/**
 * How many bytes we are willing to buffer while searching for an injection
 * point before committing to a fallback. `<html ...><head ...>` lives in the
 * first few hundred bytes of any real document; 64 KiB is a very safe ceiling
 * that still bounds memory.
 */
const DECISION_WINDOW = 64 * 1024;

export interface InjectTransformOptions {
  /**
   * The exact bytes to inject (typically a `<script nonce="..." src="..."></script>`
   * built by the caller). Provided as a string; encoded as UTF-8.
   */
  snippet: string;
}

/**
 * Find the byte index *after* which to inject for a given open-tag marker, i.e.
 * just past the '>' that closes `<head ...>` / `<html ...>`. Returns:
 *   - a number: definitive inject index (the open tag is complete in `lower`)
 *   - 'pending': the marker (or a tag-boundary candidate) is present but its
 *      closing '>' has not arrived yet — caller should wait for more bytes
 *   - null: the marker is not present at all
 */
function findInjectIndex(lower: string, marker: string): number | 'pending' | null {
  let from = 0;
  for (;;) {
    const idx = lower.indexOf(marker, from);
    if (idx === -1) return null;
    const afterPos = idx + marker.length;
    const after = lower.charCodeAt(afterPos);
    const isTagBoundary =
      after === 0x3e /* > */ ||
      after === 0x20 /* space */ ||
      after === 0x09 /* tab */ ||
      after === 0x0a /* nl */ ||
      after === 0x0d /* cr */ ||
      after === 0x2f /* / */ ||
      Number.isNaN(after); /* marker at very end — tag not finished yet */
    if (!isTagBoundary) {
      // e.g. "<header" when marker is "<head" — keep scanning.
      from = idx + 1;
      continue;
    }
    if (Number.isNaN(after)) {
      // "<head" sits at the very end of the buffer; the rest of the open tag
      // (attrs and '>') has not arrived. Wait.
      return 'pending';
    }
    const closeIdx = lower.indexOf('>', afterPos);
    if (closeIdx === -1) return 'pending'; // open tag spans into a later chunk
    return closeIdx + 1;
  }
}

export class InjectTransform extends Transform {
  private injected = false;
  /** Bytes accumulated while we have not yet found an injection point. */
  private pending: Buffer = Buffer.alloc(0);
  private readonly snippet: Buffer;

  constructor(options: InjectTransformOptions) {
    super();
    this.snippet = Buffer.from(options.snippet, 'utf8');
  }

  override _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback): void {
    if (this.injected) {
      this.push(chunk);
      cb();
      return;
    }

    this.pending = this.pending.length > 0 ? Buffer.concat([this.pending, chunk]) : chunk;
    const lower = this.pending.toString('latin1').toLowerCase();

    // Prefer <head>.
    const headAt = findInjectIndex(lower, HEAD_OPEN);
    if (typeof headAt === 'number') {
      this.commitInjection(headAt);
      cb();
      return;
    }

    // <head> is either absent or not yet complete. If we are still within the
    // decision window, keep buffering — <head> may still arrive (or finish).
    if (this.pending.length < DECISION_WINDOW) {
      cb();
      return;
    }

    // Past the window: <head> is not coming. Fall back to <html>, else prepend.
    const htmlAt = findInjectIndex(lower, HTML_OPEN);
    if (typeof htmlAt === 'number') {
      this.commitInjection(htmlAt);
    } else {
      this.commitInjection(0); // prepend
    }
    cb();
  }

  override _flush(cb: TransformCallback): void {
    if (this.injected) {
      cb();
      return;
    }

    const lower = this.pending.toString('latin1').toLowerCase();

    // <head> (now that the stream is complete, 'pending' means absent).
    const headAt = findInjectIndex(lower, HEAD_OPEN);
    if (typeof headAt === 'number') {
      this.commitInjection(headAt);
      cb();
      return;
    }

    // <html> fallback.
    const htmlAt = findInjectIndex(lower, HTML_OPEN);
    if (typeof htmlAt === 'number') {
      this.commitInjection(htmlAt);
      cb();
      return;
    }

    // Last resort: prepend.
    this.commitInjection(0);
    cb();
  }

  /**
   * Splice the snippet into the pending buffer at byte offset `at`, flush the
   * pending buffer, and flip to zero-copy pass-through for the rest of the
   * stream.
   */
  private commitInjection(at: number): void {
    this.injected = true;
    const buf = this.pending;
    this.pending = Buffer.alloc(0);
    if (at > 0) this.push(buf.subarray(0, at));
    this.push(this.snippet);
    if (at < buf.length) this.push(buf.subarray(at));
  }
}

/**
 * Build the overlay <script> tag bytes. Kept here so the proxy and tests share
 * one definition. `nonce` is optional — when present it is emitted so the CSP
 * rewrite can whitelist it.
 */
export function buildOverlayScriptTag(params: { src: string; nonce?: string }): string {
  const nonceAttr = params.nonce ? ` nonce="${escapeAttr(params.nonce)}"` : '';
  // `defer` so injection never blocks the host app's first paint; data attribute
  // is a stable marker for tests / dedupe.
  return `<script${nonceAttr} src="${escapeAttr(params.src)}" defer data-supercomment-overlay></script>`;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
