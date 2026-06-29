import { describe, it, expect } from 'vitest';
import { buildForwardHeaders, HOP_BY_HOP } from '../lib/proxy-headers';

/**
 * The retained /s tunnel reverse proxy forwards the reviewer's request to the
 * developer-controlled tunnel origin (apps/web/app/s/[slug]/[[...rest]]/route.ts,
 * proxyTunnel). A signed-in reviewer's first-party SuperComment credentials must
 * never cross that hop (the plan-001 credential leak, re-activated if the U10
 * SUPERCOMMENT_ENABLE_TUNNEL flag is flipped), so buildForwardHeaders strips
 * authorization / cookie / sb-* (plus hop-by-hop + accept-encoding) while letting
 * ordinary headers through.
 */

function survivingKeys(h: Headers): string[] {
  const keys: string[] = [];
  h.forEach((_value, key) => keys.push(key.toLowerCase()));
  return keys;
}

describe('buildForwardHeaders — credential stripping (plan-001 fix)', () => {
  it('removes authorization, cookie, and every sb-* header', () => {
    const src = new Headers({
      authorization: 'Bearer member-jwt',
      cookie: 'sb-access-token=leak; theme=dark',
      'sb-access-token': 'leak',
      'sb-refresh-token': 'leak',
      'SB-Something-Custom': 'leak', // case-insensitive prefix match
    });
    const out = buildForwardHeaders(src);

    expect(out.get('authorization')).toBeNull();
    expect(out.get('cookie')).toBeNull();
    expect(out.get('sb-access-token')).toBeNull();
    expect(out.get('sb-refresh-token')).toBeNull();
    expect(out.get('sb-something-custom')).toBeNull();

    // Nothing auth-bearing survives the forward, whatever its name.
    for (const key of survivingKeys(out)) {
      expect(
        key === 'authorization' || key === 'cookie' || key.startsWith('sb-'),
      ).toBe(false);
    }
  });

  it('passes ordinary request headers through unchanged', () => {
    const src = new Headers({
      'user-agent': 'Mozilla/5.0',
      accept: 'text/html',
      'accept-language': 'en-US',
      'content-type': 'application/json',
      'x-custom-header': 'keep-me',
    });
    const out = buildForwardHeaders(src);

    expect(out.get('user-agent')).toBe('Mozilla/5.0');
    expect(out.get('accept')).toBe('text/html');
    expect(out.get('accept-language')).toBe('en-US');
    expect(out.get('content-type')).toBe('application/json');
    expect(out.get('x-custom-header')).toBe('keep-me');
  });

  it('still strips hop-by-hop headers and accept-encoding', () => {
    const src = new Headers({
      connection: 'keep-alive',
      'transfer-encoding': 'chunked',
      host: 'evil.example',
      'accept-encoding': 'gzip, br',
      accept: 'text/html',
    });
    const out = buildForwardHeaders(src);

    expect(out.get('connection')).toBeNull();
    expect(out.get('transfer-encoding')).toBeNull();
    expect(out.get('host')).toBeNull();
    expect(out.get('accept-encoding')).toBeNull();
    expect(out.get('accept')).toBe('text/html'); // a real header still survives
  });

  it('drops credentials while keeping legitimate headers in a mixed request', () => {
    const src = new Headers({
      authorization: 'Bearer x',
      cookie: 'sb-x=y',
      'user-agent': 'UA',
      accept: '*/*',
    });
    const out = buildForwardHeaders(src);

    expect(out.get('authorization')).toBeNull();
    expect(out.get('cookie')).toBeNull();
    expect(out.get('user-agent')).toBe('UA');
    expect(out.get('accept')).toBe('*/*');
  });

  it('HOP_BY_HOP is exported for the response path and includes host/content-length', () => {
    expect(HOP_BY_HOP.has('host')).toBe(true);
    expect(HOP_BY_HOP.has('content-length')).toBe(true);
    expect(HOP_BY_HOP.has('connection')).toBe(true);
  });
});
