import { describe, it, expect } from 'vitest';
import { isSensitivePath } from './sensitive-paths.js';

describe('isSensitivePath — blocked by default', () => {
  it('blocks .env', () => {
    expect(isSensitivePath('/.env')).toBe(true);
    expect(isSensitivePath('.env')).toBe(true);
  });

  it('blocks .env.* variants', () => {
    expect(isSensitivePath('/.env.local')).toBe(true);
    expect(isSensitivePath('/.env.production')).toBe(true);
  });

  it('blocks .git/config and the .git directory', () => {
    expect(isSensitivePath('/.git/config')).toBe(true);
    expect(isSensitivePath('/.git')).toBe(true);
    expect(isSensitivePath('/sub/.git/HEAD')).toBe(true);
  });

  it('blocks JS/CSS source maps', () => {
    expect(isSensitivePath('/app.js.map')).toBe(true);
    expect(isSensitivePath('/assets/styles.css.map')).toBe(true);
  });

  it('blocks Next.js debug endpoints', () => {
    expect(isSensitivePath('/__nextjs_original-stack-frame')).toBe(true);
    expect(isSensitivePath('/__nextjs_font/foo')).toBe(true);
  });

  it('ignores query string and fragment when matching', () => {
    expect(isSensitivePath('/.env?cachebust=1')).toBe(true);
    expect(isSensitivePath('/app.js.map#section')).toBe(true);
  });

  it('matches absolute URLs too', () => {
    expect(isSensitivePath('http://localhost:5173/.env')).toBe(true);
  });
});

describe('isSensitivePath — allowed', () => {
  it('allows the document root', () => {
    expect(isSensitivePath('/')).toBe(false);
  });

  it('allows normal API and asset paths', () => {
    expect(isSensitivePath('/api/foo')).toBe(false);
    expect(isSensitivePath('/styles.css')).toBe(false);
    expect(isSensitivePath('/app.js')).toBe(false);
    expect(isSensitivePath('/index.html')).toBe(false);
  });

  it('allows /.well-known/ despite the dotted prefix', () => {
    expect(isSensitivePath('/.well-known/security.txt')).toBe(false);
    expect(isSensitivePath('/.well-known/acme-challenge/abc')).toBe(false);
  });

  it('does not falsely block paths that merely contain "env"', () => {
    expect(isSensitivePath('/environment')).toBe(false);
    expect(isSensitivePath('/api/env-config')).toBe(false);
  });

  it('does not falsely block a file named like a map but not ending .map', () => {
    expect(isSensitivePath('/sitemap.xml')).toBe(false);
  });
});

describe('isSensitivePath — configurable', () => {
  it('honors extra blocked prefixes', () => {
    expect(
      isSensitivePath('/admin/secrets', {
        extraBlockedPrefixes: ['/admin/'],
      }),
    ).toBe(true);
  });

  it('honors caller allow-list overrides', () => {
    expect(
      isSensitivePath('/.git/info', { allowedPrefixes: ['/.git/'] }),
    ).toBe(false);
  });
});
