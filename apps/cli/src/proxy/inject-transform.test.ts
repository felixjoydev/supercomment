import { describe, it, expect } from 'vitest';
import { Readable } from 'node:stream';
import { InjectTransform, buildOverlayScriptTag } from './inject-transform.js';

const SNIPPET = '<script src="/overlay.js" data-supercomment-overlay></script>';

/** Pipe an array of chunks through the transform and collect the output bytes. */
async function run(chunks: Array<Buffer | string>, snippet = SNIPPET): Promise<Buffer> {
  const input = chunks.map((c) => (typeof c === 'string' ? Buffer.from(c, 'utf8') : c));
  const transform = new InjectTransform({ snippet });
  const source = Readable.from(input);
  const out: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    source.pipe(transform);
    transform.on('data', (d: Buffer) => out.push(d));
    transform.on('end', resolve);
    transform.on('error', reject);
  });
  return Buffer.concat(out);
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe('InjectTransform', () => {
  it('injects exactly one script immediately after <head>', async () => {
    const html = '<!doctype html><html><head><title>x</title></head><body>hi</body></html>';
    const result = (await run([html])).toString('utf8');
    expect(count(result, SNIPPET)).toBe(1);
    // Inserted right after the <head> open tag's '>'.
    expect(result).toContain('<head>' + SNIPPET);
    // Original content is otherwise preserved.
    expect(result.replace(SNIPPET, '')).toBe(html);
  });

  it('injects after <head ...> with attributes', async () => {
    const html = '<html><head lang="en" data-x><meta></head><body></body></html>';
    const result = (await run([html])).toString('utf8');
    expect(count(result, SNIPPET)).toBe(1);
    expect(result).toContain('<head lang="en" data-x>' + SNIPPET);
  });

  it('does NOT match <header> (false-positive guard)', async () => {
    const html = '<html><body><header>nav</header></body></html>';
    const result = (await run([html])).toString('utf8');
    // No <head>, no <html>... wait there is <html>; falls back to after <html>.
    expect(count(result, SNIPPET)).toBe(1);
    expect(result).toContain('<html>' + SNIPPET);
    // <header> untouched.
    expect(result).toContain('<header>nav</header>');
  });

  it('injects exactly once when <head> is split across two chunks', async () => {
    // Boundary right inside the marker: "...<he" | "ad>..."
    const a = '<!doctype html><html><he';
    const b = 'ad><title>t</title></head><body>b</body></html>';
    const result = (await run([a, b])).toString('utf8');
    expect(count(result, SNIPPET)).toBe(1);
    expect(result).toContain('<head>' + SNIPPET);
    expect(result.replace(SNIPPET, '')).toBe(a + b);
  });

  it('injects once when the open tag close ">" is in a later chunk', async () => {
    // "<head" present but ">" only arrives in chunk 3.
    const chunks = ['<html><head ', 'lang="en"', '><body></body></html>'];
    const result = (await run(chunks)).toString('utf8');
    expect(count(result, SNIPPET)).toBe(1);
    expect(result).toContain('<head lang="en">' + SNIPPET);
    expect(result.replace(SNIPPET, '')).toBe(chunks.join(''));
  });

  it('injects once and preserves all bytes across many tiny chunks', async () => {
    const html =
      '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>Big</title>\n</head>\n<body>\n<p>Hello, 世界 — café</p>\n</body>\n</html>\n';
    // Split into 1-byte chunks (still UTF-8 safe because the transform scans
    // bytes via latin1 and only matches ASCII markers).
    const bytes = Buffer.from(html, 'utf8');
    const oneByteChunks = Array.from(bytes, (b) => Buffer.from([b]));
    const result = await run(oneByteChunks);
    const text = result.toString('utf8');
    expect(count(text, SNIPPET)).toBe(1);
    // Every original byte preserved (multi-byte UTF-8 intact).
    expect(result.length).toBe(bytes.length + Buffer.byteLength(SNIPPET, 'utf8'));
    expect(text.replace(SNIPPET, '')).toBe(html);
  });

  it('falls back to after <html> when there is no <head>', async () => {
    const html = '<html><body>no head here</body></html>';
    const result = (await run([html])).toString('utf8');
    expect(count(result, SNIPPET)).toBe(1);
    expect(result).toContain('<html>' + SNIPPET);
    expect(result.replace(SNIPPET, '')).toBe(html);
  });

  it('prepends when there is neither <head> nor <html>', async () => {
    const html = '<body>fragment-like</body>';
    const result = (await run([html])).toString('utf8');
    expect(count(result, SNIPPET)).toBe(1);
    expect(result.startsWith(SNIPPET)).toBe(true);
    expect(result.slice(SNIPPET.length).toString()).toBe(html);
  });

  it('handles empty body without throwing (prepends snippet)', async () => {
    const result = (await run([''])).toString('utf8');
    expect(result).toBe(SNIPPET);
  });

  it('matches case-insensitively (<HEAD>)', async () => {
    const html = '<HTML><HEAD></HEAD><BODY></BODY></HTML>';
    const result = (await run([html])).toString('utf8');
    expect(count(result, SNIPPET)).toBe(1);
    expect(result).toContain('<HEAD>' + SNIPPET);
  });
});

describe('buildOverlayScriptTag', () => {
  it('emits a nonce attribute when a nonce is given', () => {
    const tag = buildOverlayScriptTag({ src: '/o.js', nonce: 'abc123' });
    expect(tag).toContain('nonce="abc123"');
    expect(tag).toContain('src="/o.js"');
    expect(tag).toContain('data-supercomment-overlay');
  });

  it('omits the nonce attribute when none is given', () => {
    const tag = buildOverlayScriptTag({ src: '/o.js' });
    expect(tag).not.toContain('nonce=');
  });

  it('escapes attribute values', () => {
    const tag = buildOverlayScriptTag({ src: '/o.js?a="b"&c=<d>', nonce: 'n' });
    expect(tag).toContain('&quot;');
    expect(tag).toContain('&amp;');
    expect(tag).toContain('&lt;');
    expect(tag).not.toContain('"b"');
  });
});
