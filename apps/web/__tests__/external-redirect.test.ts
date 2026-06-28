import { describe, it, expect } from 'vitest';
import {
  isAllowedDeployUrl,
  classifyDeployUrl,
  type DeployUrlReason,
} from '../lib/external-redirect';

/**
 * Unit tests for the shared deploy-URL allowlist validator. This is the value
 * /s later trusts as a redirect target, so the rules must hold: https only, no
 * IP literals / localhost / mDNS / credentials, public DNS host. The SQL RPC
 * (0017_register_deploy_target.sql) mirrors these rules — keep them in sync.
 */

const allowed = [
  'https://my-app.vercel.app',
  'https://my-app.netlify.app',
  'https://feature-x.pages.dev',
  'https://app.fly.dev',
  'https://svc.onrender.com',
  'https://preview.example.com',
  'https://preview.example.com/some/path?q=1',
  'https://preview.example.com:8443', // non-standard port is fine
  'https://sub.domain.co.uk',
  'https://EXAMPLE.COM', // case-insensitive host
  '  https://spaced.example.com  ', // surrounding whitespace trimmed
];

// [url, expected reason] — every rejection path.
const rejected: [string, DeployUrlReason][] = [
  ['', 'invalid-url'],
  ['   ', 'invalid-url'],
  ['not a url', 'invalid-url'],
  ['//evil.com', 'invalid-url'], // protocol-relative is not absolute
  ['https://', 'invalid-url'],
  ['example.com', 'invalid-url'], // no scheme
  ['http://my-app.vercel.app', 'not-https'],
  ['ftp://example.com', 'not-https'],
  ['data:text/html,hi', 'not-https'],
  ['javascript:alert(1)', 'not-https'],
  ['javascript:fetch("/x")', 'not-https'],
  ['file:///etc/passwd', 'not-https'],
  ['https://user:pass@evil.com', 'has-credentials'],
  ['https://user@evil.com', 'has-credentials'],
  ['https://127.0.0.1', 'ip-literal'],
  ['https://192.168.1.10', 'ip-literal'],
  ['https://10.0.0.1', 'ip-literal'],
  ['https://172.16.5.4', 'ip-literal'],
  ['https://169.254.0.1', 'ip-literal'], // link-local
  ['https://8.8.8.8', 'ip-literal'], // even a public IP literal is rejected
  ['https://2130706433', 'ip-literal'], // decimal IPv4 (127.0.0.1)
  ['https://0x7f.1', 'ip-literal'], // hex IPv4 form
  ['https://0', 'ip-literal'], // → 0.0.0.0
  ['https://[::1]', 'ip-literal'], // IPv6 loopback
  ['https://[2001:db8::1]', 'ip-literal'],
  ['https://[fe80::1]', 'ip-literal'], // IPv6 link-local
  ['https://localhost', 'localhost'],
  ['https://localhost:3000', 'localhost'],
  ['https://api.localhost', 'localhost'],
  ['https://app.local', 'mdns-local'],
  ['https://local', 'mdns-local'],
  ['https://intranet', 'non-public-host'], // single-label internal name
];

describe('isAllowedDeployUrl — accepted public https hosts', () => {
  for (const url of allowed) {
    it(`accepts ${JSON.stringify(url)}`, () => {
      expect(isAllowedDeployUrl(url)).toBe(true);
      expect(classifyDeployUrl(url).reason).toBe('ok');
    });
  }
});

describe('isAllowedDeployUrl — rejections', () => {
  for (const [url, reason] of rejected) {
    it(`rejects ${JSON.stringify(url)} (${reason})`, () => {
      expect(isAllowedDeployUrl(url)).toBe(false);
      const result = classifyDeployUrl(url);
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(reason);
      // every rejection carries a non-empty, human-readable message
      expect(result.message.length).toBeGreaterThan(0);
    });
  }
});

describe('classifyDeployUrl — shape', () => {
  it('returns ok=true with reason "ok" and a message for a valid host', () => {
    expect(classifyDeployUrl('https://my-app.vercel.app')).toEqual({
      ok: true,
      reason: 'ok',
      message: expect.any(String),
    });
  });

  it('private/loopback ranges are all covered by the IP-literal rule', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.1', '172.31.255.255', '169.254.1.1']) {
      expect(classifyDeployUrl(`https://${ip}`).reason).toBe('ip-literal');
    }
  });

  it('is robust to non-string input', () => {
    // exercises the runtime guard; callers may pass untyped JSON
    expect(isAllowedDeployUrl(undefined as unknown as string)).toBe(false);
    expect(isAllowedDeployUrl(null as unknown as string)).toBe(false);
    expect(isAllowedDeployUrl(123 as unknown as string)).toBe(false);
  });
});
