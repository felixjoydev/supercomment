import { describe, it, expect } from 'vitest';
import { isWebTunnelEnabled } from '../lib/tunnel-gate';

/**
 * The hosted /s tunnel reverse proxy (route.ts proxyTunnel) is dormant unless
 * SUPERCOMMENT_ENABLE_TUNNEL opts in (H1). Default off keeps an
 * attacker-registered tunnel from ever being served same-origin as the
 * dashboard. Behaviour must match the CLI's isTunnelEnabled so one env var
 * governs both processes.
 */
describe('isWebTunnelEnabled — default-off tunnel gate (H1)', () => {
  it('is disabled when the flag is unset (the production default)', () => {
    expect(isWebTunnelEnabled(undefined)).toBe(false);
  });

  it.each(['', '0', 'false', 'no', 'off', ' OFF ', 'False'])(
    'is disabled for the falsey spelling %o',
    (raw) => {
      expect(isWebTunnelEnabled(raw)).toBe(false);
    },
  );

  it.each(['1', 'true', 'yes', 'on', ' 1 ', 'TRUE'])(
    'is enabled for the truthy spelling %o',
    (raw) => {
      expect(isWebTunnelEnabled(raw)).toBe(true);
    },
  );
});
