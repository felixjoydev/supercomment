import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import net from 'node:net';
import { AddressInfo } from 'node:net';
import { createProxy } from './index.js';
import { rewriteCsp } from './csp.js';

const OVERLAY_URL = 'https://app.supercomment.test/overlay.js';
const BACKEND_ORIGIN = 'https://app.supercomment.test';

/** Start an http server with a handler; resolve with {url, close}. */
function startServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<{ url: string; port: number; server: http.Server }> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}`, port, server });
    });
  });
}

/** Minimal GET that returns status, headers, and the raw body buffer. */
function get(
  url: string,
  options: http.RequestOptions = {},
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = http.request(url, options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () =>
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: Buffer.concat(chunks),
        }),
      );
    });
    req.on('error', reject);
    req.end();
  });
}

describe('createProxy — content-type gating & injection', () => {
  let upstream: { url: string; port: number; server: http.Server };
  let proxy: http.Server;
  let proxyUrl: string;

  beforeAll(async () => {
    upstream = await startServer((req, res) => {
      const url = req.url ?? '/';
      if (url === '/page.html') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end('<!doctype html><html><head><title>Hi</title></head><body>ok</body></html>');
        return;
      }
      if (url === '/streamed.html') {
        res.writeHead(200, { 'content-type': 'text/html' });
        // Stream chunks with <head> split across the boundary.
        res.write('<html><he');
        setTimeout(() => {
          res.write('ad><title>s</title></head><body>');
          res.end('streamed</body></html>');
        }, 5);
        return;
      }
      if (url === '/data.json') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ a: 1, head: '<head>not html</head>' }));
        return;
      }
      if (url === '/app.js') {
        res.writeHead(200, { 'content-type': 'application/javascript' });
        res.end('const x = "<head>"; console.log(x);');
        return;
      }
      if (url === '/style.css') {
        res.writeHead(200, { 'content-type': 'text/css' });
        res.end('body{color:red} /* <head> */');
        return;
      }
      if (url === '/events') {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.end('data: <head>\n\n');
        return;
      }
      if (url === '/boom') {
        res.writeHead(500, { 'content-type': 'text/html' });
        res.end('<html><head></head><body>upstream error</body></html>');
        return;
      }
      if (url === '/error-plain') {
        res.writeHead(500, { 'content-type': 'text/plain' });
        res.end('kaboom <head> not injected');
        return;
      }
      if (url === '/csp.html') {
        res.writeHead(200, {
          'content-type': 'text/html',
          'content-security-policy': "default-src 'self'; script-src 'self' 'strict-dynamic'",
        });
        res.end('<html><head></head><body></body></html>');
        return;
      }
      if (url === '/nocsp.html') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<html><head></head><body></body></html>');
        return;
      }
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('nf');
    });

    const p = createProxy({
      target: upstream.url,
      overlayScriptUrl: OVERLAY_URL,
      backendOrigin: BACKEND_ORIGIN,
      nonce: 'TESTNONCE',
    });
    proxy = await new Promise<http.Server>((resolve) => {
      const s = http.createServer();
      p.attach(s);
      s.listen(0, '127.0.0.1', () => resolve(s));
    });
    proxyUrl = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((r) => proxy.close(() => r()));
    await new Promise<void>((r) => upstream.server.close(() => r()));
  });

  it('injects exactly one overlay script into an HTML page after <head>', async () => {
    const res = await get(`${proxyUrl}/page.html`);
    const body = res.body.toString('utf8');
    expect(res.status).toBe(200);
    const occurrences = body.split('data-supercomment-overlay').length - 1;
    expect(occurrences).toBe(1);
    expect(body).toContain('nonce="TESTNONCE"');
    expect(body).toContain('src="' + OVERLAY_URL + '"');
    // Position: right after <head>.
    expect(body).toContain('<head><script');
  });

  it('drops stale Content-Length when injecting', async () => {
    const res = await get(`${proxyUrl}/page.html`);
    // Upstream sent no explicit length here (end()), but assert we never emit a
    // length that mismatches the injected body.
    if (res.headers['content-length']) {
      expect(Number(res.headers['content-length'])).toBe(res.body.length);
    }
  });

  it('injects exactly once for a streamed, chunk-split <head>', async () => {
    const res = await get(`${proxyUrl}/streamed.html`);
    const body = res.body.toString('utf8');
    const occurrences = body.split('data-supercomment-overlay').length - 1;
    expect(occurrences).toBe(1);
    expect(body).toContain('<head><script');
    expect(body).toContain('streamed</body>');
  });

  it('passes JSON through byte-identical (no injection)', async () => {
    const direct = await get(`${upstream.url}/data.json`);
    const viaProxy = await get(`${proxyUrl}/data.json`);
    expect(viaProxy.body.equals(direct.body)).toBe(true);
    expect(viaProxy.body.toString()).not.toContain('data-supercomment-overlay');
  });

  it('passes JS through byte-identical (no injection)', async () => {
    const direct = await get(`${upstream.url}/app.js`);
    const viaProxy = await get(`${proxyUrl}/app.js`);
    expect(viaProxy.body.equals(direct.body)).toBe(true);
  });

  it('passes CSS through byte-identical (no injection)', async () => {
    const direct = await get(`${upstream.url}/style.css`);
    const viaProxy = await get(`${proxyUrl}/style.css`);
    expect(viaProxy.body.equals(direct.body)).toBe(true);
  });

  it('passes text/event-stream through untouched (no injection)', async () => {
    const direct = await get(`${upstream.url}/events`);
    const viaProxy = await get(`${proxyUrl}/events`);
    expect(viaProxy.body.equals(direct.body)).toBe(true);
    expect(viaProxy.body.toString()).not.toContain('data-supercomment-overlay');
  });

  it('injects into a 500 HTML error body without corrupting it', async () => {
    const res = await get(`${proxyUrl}/boom`);
    expect(res.status).toBe(500);
    const body = res.body.toString('utf8');
    expect(body).toContain('upstream error');
    expect(body.split('data-supercomment-overlay').length - 1).toBe(1);
  });

  it('passes a non-HTML 500 error body through byte-identical', async () => {
    const direct = await get(`${upstream.url}/error-plain`);
    const viaProxy = await get(`${proxyUrl}/error-plain`);
    expect(viaProxy.status).toBe(500);
    expect(viaProxy.body.equals(direct.body)).toBe(true);
    expect(viaProxy.body.toString()).not.toContain('data-supercomment-overlay');
  });

  it('rewrites an existing strict CSP to allow the nonce (never unsafe-inline)', async () => {
    const res = await get(`${proxyUrl}/csp.html`);
    const csp = res.headers['content-security-policy'] as string;
    expect(csp).toBeTruthy();
    expect(csp).toContain("'nonce-TESTNONCE'");
    expect(csp).not.toContain('unsafe-inline');
    // strict-dynamic preserved.
    expect(csp).toContain("'strict-dynamic'");
    // backend origin added to connect-src.
    expect(csp).toContain('connect-src');
    expect(csp).toContain(BACKEND_ORIGIN);
  });

  it('leaves a response with no CSP header without adding one', async () => {
    const res = await get(`${proxyUrl}/nocsp.html`);
    expect(res.headers['content-security-policy']).toBeUndefined();
    // But still injects the overlay.
    expect(res.body.toString().split('data-supercomment-overlay').length - 1).toBe(1);
  });

  it('forwards a 404 verbatim', async () => {
    const res = await get(`${proxyUrl}/missing`);
    expect(res.status).toBe(404);
    expect(res.body.toString()).toBe('nf');
  });

  it('returns 502 when the upstream is unreachable', async () => {
    const dead = createProxy({
      target: 'http://127.0.0.1:1', // nothing listening
      overlayScriptUrl: OVERLAY_URL,
    });
    const s = await new Promise<http.Server>((resolve) => {
      const srv = http.createServer();
      dead.attach(srv);
      srv.listen(0, '127.0.0.1', () => resolve(srv));
    });
    try {
      const url = `http://127.0.0.1:${(s.address() as AddressInfo).port}/`;
      const res = await get(url);
      expect(res.status).toBe(502);
    } finally {
      await new Promise<void>((r) => s.close(() => r()));
    }
  });
});

describe('createProxy — WebSocket / HMR upgrade passthrough', () => {
  it('registers an upgrade handler on the server', async () => {
    const p = createProxy({ target: 'http://127.0.0.1:1', overlayScriptUrl: OVERLAY_URL });
    const server = http.createServer();
    p.attach(server);
    expect(server.listenerCount('upgrade')).toBe(1);
    expect(server.listenerCount('request')).toBe(1);
  });

  it('forwards an HTTP Upgrade to the upstream and pipes bytes both ways', async () => {
    // Mock upstream that completes a WS-style handshake and echoes one frame.
    // VERIFY IN REAL ENV: this proves the upgrade is forwarded and bytes flow
    // through; real Vite/Next HMR fast-refresh in a browser must be verified
    // manually against live dev servers.
    const upstream = net.createServer((sock) => {
      let buf = '';
      sock.on('data', (d) => {
        buf += d.toString('latin1');
        if (buf.includes('\r\n\r\n')) {
          expect(buf).toContain('GET /hmr HTTP/1.1');
          expect(buf.toLowerCase()).toContain('upgrade: websocket');
          // Forwarded proto header present.
          expect(buf.toLowerCase()).toContain('x-forwarded-proto: https');
          sock.write(
            'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n',
          );
          sock.write('HELLO_FROM_UPSTREAM');
        }
      });
    });
    await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', () => r()));
    const upstreamPort = (upstream.address() as AddressInfo).port;

    const p = createProxy({
      target: `http://127.0.0.1:${upstreamPort}`,
      overlayScriptUrl: OVERLAY_URL,
    });
    const server = http.createServer();
    p.attach(server);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const proxyPort = (server.address() as AddressInfo).port;

    const received = await new Promise<string>((resolve, reject) => {
      const client = net.connect(proxyPort, '127.0.0.1', () => {
        client.write(
          [
            'GET /hmr HTTP/1.1',
            `Host: 127.0.0.1:${proxyPort}`,
            'Connection: Upgrade',
            'Upgrade: websocket',
            'Sec-WebSocket-Version: 13',
            'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
            '',
            '',
          ].join('\r\n'),
        );
      });
      let acc = '';
      client.on('data', (d) => {
        acc += d.toString('latin1');
        if (acc.includes('HELLO_FROM_UPSTREAM')) {
          client.destroy();
          resolve(acc);
        }
      });
      client.on('error', reject);
      setTimeout(() => reject(new Error('timeout waiting for upstream bytes')), 2000);
    });

    expect(received).toContain('101 Switching Protocols');
    expect(received).toContain('HELLO_FROM_UPSTREAM');

    await new Promise<void>((r) => server.close(() => r()));
    await new Promise<void>((r) => upstream.close(() => r()));
  });
});

describe('rewriteCsp (unit)', () => {
  it('adds the nonce to an existing script-src', () => {
    const out = rewriteCsp("script-src 'self'", { nonce: 'N1' });
    expect(out).toContain("script-src 'self' 'nonce-N1'");
    expect(out).not.toContain('unsafe-inline');
  });

  it('materializes script-src from default-src when script-src is absent', () => {
    const out = rewriteCsp("default-src 'self' https://cdn.example", { nonce: 'N1' });
    // script-src should be created seeded from default-src, then nonce added.
    expect(out).toContain('script-src');
    expect(out).toContain("'self'");
    expect(out).toContain('https://cdn.example');
    expect(out).toContain("'nonce-N1'");
  });

  it('adds the backend origin to connect-src', () => {
    const out = rewriteCsp("default-src 'self'; connect-src 'self'", {
      nonce: 'N1',
      connectOrigin: 'https://api.example',
    });
    expect(out).toContain("connect-src 'self' https://api.example");
  });

  it('materializes connect-src from default-src when absent', () => {
    const out = rewriteCsp("default-src 'self'", {
      nonce: 'N1',
      connectOrigin: 'https://api.example',
    });
    expect(out).toContain('connect-src');
    expect(out).toContain('https://api.example');
  });

  it('is idempotent (no duplicate nonce/origin on re-run)', () => {
    const once = rewriteCsp("script-src 'self'", {
      nonce: 'N1',
      connectOrigin: 'https://api.example',
    });
    const twice = rewriteCsp(once, { nonce: 'N1', connectOrigin: 'https://api.example' });
    expect(twice).toBe(once);
  });

  it('preserves strict-dynamic', () => {
    const out = rewriteCsp("script-src 'strict-dynamic'", { nonce: 'N1' });
    expect(out).toContain("'strict-dynamic'");
    expect(out).toContain("'nonce-N1'");
  });
});
