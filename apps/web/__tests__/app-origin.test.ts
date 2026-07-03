import { describe, it, expect } from 'vitest';
import { authRedirectOrigin } from '../lib/app-origin';

/**
 * M4: auth redirect URLs must come from NEXT_PUBLIC_APP_URL in production, never
 * the spoofable Host header (an attacker who controls Host could redirect a
 * victim's magic-link/OAuth code to their own origin and take over the account).
 */
describe('authRedirectOrigin — M4 spoofable-Host fix', () => {
  it('uses NEXT_PUBLIC_APP_URL when set, ignoring a spoofed Host (+ strips trailing slash)', () => {
    expect(
      authRedirectOrigin({
        appUrl: 'https://supercomment.vercel.app/',
        host: 'attacker.example',
        proto: 'https',
        isProduction: true,
      }),
    ).toBe('https://supercomment.vercel.app');
  });

  it('throws in production when NEXT_PUBLIC_APP_URL is unset (never trusts Host)', () => {
    expect(() =>
      authRedirectOrigin({
        appUrl: undefined,
        host: 'attacker.example',
        proto: 'https',
        isProduction: true,
      }),
    ).toThrow(/NEXT_PUBLIC_APP_URL/);
    expect(() =>
      authRedirectOrigin({ appUrl: '   ', host: 'x', proto: null, isProduction: true }),
    ).toThrow();
  });

  it('falls back to the request origin in dev only', () => {
    expect(
      authRedirectOrigin({ appUrl: '', host: 'localhost:3000', proto: null, isProduction: false }),
    ).toBe('http://localhost:3000');
    expect(
      authRedirectOrigin({ appUrl: null, host: 'dev.local:8080', proto: 'https', isProduction: false }),
    ).toBe('https://dev.local:8080');
  });

  it('defaults the dev host + proto when neither is present', () => {
    expect(authRedirectOrigin({ isProduction: false })).toBe('http://localhost:3000');
  });
});
