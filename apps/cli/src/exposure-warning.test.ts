import { describe, it, expect } from 'vitest';
import {
  buildExposureWarning,
  DEFAULT_ACCESS_MODE,
} from './exposure-warning.js';

describe('buildExposureWarning', () => {
  it('names the host:port being exposed', () => {
    const out = buildExposureWarning({
      port: 5173,
      host: '127.0.0.1',
      accessMode: 'team-only',
    });
    expect(out).toContain('127.0.0.1:5173');
  });

  it('names the access mode', () => {
    const out = buildExposureWarning({
      port: 3000,
      host: '0.0.0.0',
      accessMode: 'team-only',
    });
    expect(out).toContain('team-only');
  });

  it('states team-only is the safe default', () => {
    const out = buildExposureWarning({
      port: 3000,
      host: '127.0.0.1',
      accessMode: 'team-only',
    });
    expect(out.toLowerCase()).toContain('safe default');
    expect(out).toContain('team');
  });

  it('warns that a guest link exposes the running app to anyone with the link', () => {
    const out = buildExposureWarning({
      port: 3000,
      host: '127.0.0.1',
      accessMode: 'guest',
    });
    expect(out.toLowerCase()).toContain('guest');
    expect(out.toLowerCase()).toContain('anyone who has the link');
    // It also reminds the dev that team-only is the default.
    expect(out).toContain(DEFAULT_ACCESS_MODE);
  });

  it('default access mode constant is team-only', () => {
    expect(DEFAULT_ACCESS_MODE).toBe('team-only');
  });
});
