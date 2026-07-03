import { describe, it, expect } from 'vitest';
import { isSensitivePath, safeUpstreamPath } from './sensitive-paths.js';

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

describe('isSensitivePath — encoded / traversal bypasses (H2 fix)', () => {
  it('blocks percent-encoded dots: /%2eenv, /%2egit/config, app.js%2emap', () => {
    expect(isSensitivePath('/%2eenv')).toBe(true);
    expect(isSensitivePath('/%2egit/config')).toBe(true);
    expect(isSensitivePath('/app.js%2emap')).toBe(true);
  });

  it('blocks double-encoded dots (/%252eenv -> %2eenv -> .env)', () => {
    expect(isSensitivePath('/%252eenv')).toBe(true);
    expect(isSensitivePath('/%252egit/config')).toBe(true);
  });

  it('blocks path traversal to a sensitive file', () => {
    expect(isSensitivePath('/foo/../.env')).toBe(true);
    expect(isSensitivePath('/assets/../.git/config')).toBe(true);
    expect(isSensitivePath('/a/b/../../.env')).toBe(true);
  });

  it('blocks encoded-backslash traversal (/..%5c.env)', () => {
    expect(isSensitivePath('/..%5c.env')).toBe(true);
    expect(isSensitivePath('/x%5c.git%5cconfig')).toBe(true);
  });

  it('blocks the %00 truncation trick (/.env%00.png -> /.env)', () => {
    expect(isSensitivePath('/.env%00.png')).toBe(true);
    expect(isSensitivePath('/app.js.map%00.js')).toBe(true);
  });

  it('blocks case + trailing dot/space variants (Windows resolves them to the real file)', () => {
    expect(isSensitivePath('/.ENV')).toBe(true);
    expect(isSensitivePath('/.env.')).toBe(true);
    expect(isSensitivePath('/.env%20')).toBe(true);
    expect(isSensitivePath('/App.JS.MAP')).toBe(true);
  });
});

describe('isSensitivePath — expanded denylist (H2)', () => {
  it('blocks Vite arbitrary-file-read prefixes (/@fs/, /@id/)', () => {
    expect(isSensitivePath('/@fs/etc/passwd')).toBe(true);
    expect(isSensitivePath('/@fs/Users/me/.ssh/id_rsa')).toBe(true);
    expect(isSensitivePath('/@id/__x00__virtual')).toBe(true);
  });

  it('blocks credential directories addressed as a segment', () => {
    expect(isSensitivePath('/.ssh/id_rsa')).toBe(true);
    expect(isSensitivePath('/home/.aws/credentials')).toBe(true);
    expect(isSensitivePath('/.gnupg/secring.gpg')).toBe(true);
    expect(isSensitivePath('/.kube/config')).toBe(true);
  });

  it('blocks credential/config dotfiles', () => {
    expect(isSensitivePath('/.npmrc')).toBe(true);
    expect(isSensitivePath('/.netrc')).toBe(true);
    expect(isSensitivePath('/.htpasswd')).toBe(true);
    expect(isSensitivePath('/.git-credentials')).toBe(true);
  });

  it('blocks private keys / certs / keystores', () => {
    expect(isSensitivePath('/certs/server.pem')).toBe(true);
    expect(isSensitivePath('/tls.key')).toBe(true);
    expect(isSensitivePath('/id.pfx')).toBe(true);
    expect(isSensitivePath('/store.p12')).toBe(true);
    expect(isSensitivePath('/app.keystore')).toBe(true);
  });

  it('blocks other VCS metadata dirs (.hg, .svn)', () => {
    expect(isSensitivePath('/.svn/entries')).toBe(true);
    expect(isSensitivePath('/.hg/store')).toBe(true);
  });

  it('blocks backup / editor / swap files', () => {
    expect(isSensitivePath('/config.php~')).toBe(true);
    expect(isSensitivePath('/dump.sql.bak')).toBe(true);
    expect(isSensitivePath('/main.tf.orig')).toBe(true);
    expect(isSensitivePath('/notes.save')).toBe(true);
    expect(isSensitivePath('/.index.js.swp')).toBe(true);
    expect(isSensitivePath('/.DS_Store')).toBe(true);
  });

  it('does not over-block look-alike but legitimate paths', () => {
    // substring-only matches must NOT trip the segment/extension rules
    expect(isSensitivePath('/aws-sdk/dist/index.js')).toBe(false); // 'aws' not '.aws'
    expect(isSensitivePath('/donkey.js')).toBe(false); // ends '.js', not '.key'
    expect(isSensitivePath('/keys/list.json')).toBe(false); // 'keys' segment, .json ext
    expect(isSensitivePath('/fastfile')).toBe(false);
    expect(isSensitivePath('/@vite/client')).toBe(false); // only /@fs//@id/ are blocked
    expect(isSensitivePath('/.well-known/security.txt')).toBe(false);
  });
});

describe('safeUpstreamPath — check and forward agree (H2)', () => {
  it('is a no-op for ordinary paths and preserves the query verbatim', () => {
    expect(safeUpstreamPath('/api/foo?x=1&y=2')).toBe('/api/foo?x=1&y=2');
    expect(safeUpstreamPath('/assets/app.js')).toBe('/assets/app.js');
    expect(safeUpstreamPath('/')).toBe('/');
  });

  it('forwards the SAME canonical path the matcher inspected', () => {
    expect(safeUpstreamPath('/%2eenv')).toBe('/.env');
    expect(safeUpstreamPath('/foo/../bar')).toBe('/bar');
    expect(safeUpstreamPath('/a/./b')).toBe('/a/b');
  });

  it('re-encodes spaces while leaving the query encoding untouched', () => {
    expect(safeUpstreamPath('/assets/my file.js')).toBe('/assets/my%20file.js');
    expect(safeUpstreamPath('/search?q=a%20b')).toBe('/search?q=a%20b');
  });

  it('preserves a trailing slash (dir vs file semantics)', () => {
    expect(safeUpstreamPath('/docs/')).toBe('/docs/');
  });
});
