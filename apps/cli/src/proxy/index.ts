import http, {
  type IncomingMessage,
  type ServerResponse,
  type RequestOptions,
} from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { randomBytes } from 'node:crypto';
import { URL } from 'node:url';
import { InjectTransform, buildOverlayScriptTag } from './inject-transform.js';
import { rewriteCsp, CSP_HEADER_NAMES } from './csp.js';
import { isSensitivePath } from './sensitive-paths.js';

/**
 * Reverse proxy with overlay injection (U3).
 *
 * Library choice: a custom proxy built on Node's built-in `http`/`https`
 * modules rather than `http-proxy-middleware`.
 *
 * Why:
 *   - The hard part of U3 — boundary-safe streamed injection, Content-Type
 *     gating, CSP rewrite, dropping stale Content-Length, and HMR WebSocket
 *     passthrough — is all custom logic regardless of the proxy library. Owning
 *     the request/response plumbing keeps that logic explicit and dependency-light
 *     (no `http-proxy-middleware`/`httpxy` transitive surface, no install risk in
 *     constrained environments), and lets us stream the body through our
 *     `InjectTransform` without buffering the whole document.
 *   - We deliberately STREAM rather than buffer-and-rewrite (the alternative
 *     `responseInterceptor` approach): SSR streaming dev servers (Next.js App
 *     Router) emit HTML progressively and buffering would defeat streaming. The
 *     sticky-buffer Transform in `inject-transform.ts` handles chunk-boundary
 *     splits.
 *   - Because we strip `Accept-Encoding` on the upstream request (below), the
 *     dev server returns identity-encoded HTML, so we never decompress/recompress.
 *
 * The factory returns both a Node request handler and an `upgrade` handler, plus
 * a convenience `listen()` that wires them onto an http.Server (including the
 * `server.on('upgrade', ...)` needed for HMR WebSockets).
 */

export interface ProxyConfig {
  /** Upstream dev server origin, e.g. "http://localhost:5173". */
  target: string;
  /**
   * URL of the overlay script to inject (the U6 IIFE bundle, served elsewhere).
   * A placeholder is fine for U3; the tag is what matters.
   */
  overlayScriptUrl: string;
  /**
   * Backend origin the overlay talks to (added to CSP connect-src). Optional.
   */
  backendOrigin?: string;
  /**
   * Nonce to place on the injected <script> and add to CSP script-src. If not
   * provided, a per-process nonce is generated. (Per-request nonces would
   * require reading the page's own nonce; that is a documented future refinement
   * — see VERIFY IN REAL ENV note below.)
   */
  nonce?: string;
}

/** Content types we treat as full HTML documents eligible for injection. */
function isInjectableHtml(contentType: string | undefined): boolean {
  if (!contentType) return false;
  const ct = contentType.toLowerCase();
  // Strictly text/html. Explicitly NOT: application/json, text/javascript,
  // application/javascript, text/css, text/event-stream, image/*, fragments
  // sent as something other than text/html.
  return ct.includes('text/html');
}

/** Hop-by-hop headers that must not be forwarded (RFC 7230 §6.1). */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

function chooseTransport(targetUrl: URL): typeof http | typeof https {
  return targetUrl.protocol === 'https:' ? https : http;
}

export interface Proxy {
  /** Node request handler: (req, res) => void. */
  handleRequest: (req: IncomingMessage, res: ServerResponse) => void;
  /** Node 'upgrade' handler for WebSocket/HMR passthrough. */
  handleUpgrade: (req: IncomingMessage, socket: net.Socket, head: Buffer) => void;
  /** The effective nonce used for injection + CSP. */
  nonce: string;
  /** Create an http.Server with both handlers wired and start listening. */
  listen: (port: number, hostname?: string) => http.Server;
  /** Wire both handlers onto an existing server (e.g. for tests). */
  attach: (server: http.Server) => void;
}

export function createProxy(config: ProxyConfig): Proxy {
  const target = new URL(config.target);
  const transport = chooseTransport(target);
  const nonce = config.nonce ?? randomBytes(16).toString('base64url');
  const scriptTag = buildOverlayScriptTag({ src: config.overlayScriptUrl, nonce });

  function buildUpstreamHeaders(
    req: IncomingMessage,
  ): Record<string, string | string[]> {
    const headers: Record<string, string | string[]> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (value === undefined) continue;
      const lower = key.toLowerCase();
      if (HOP_BY_HOP.has(lower)) continue;
      // Strip Accept-Encoding so upstream returns identity (no gzip/br) — we then
      // never need to decompress before injecting.
      if (lower === 'accept-encoding') continue;
      headers[key] = value;
    }
    // Point Host at the upstream so dev-server host checks pass for localhost.
    headers['host'] = target.host;
    // Tell the upstream we are an HTTPS-fronted proxy so it builds https URLs and
    // secure cookies behave (mixed-content avoidance).
    headers['x-forwarded-proto'] = 'https';
    headers['x-forwarded-host'] = req.headers['host'] ?? target.host;
    return headers;
  }

  const handleRequest = (req: IncomingMessage, res: ServerResponse): void => {
    const reqUrl = req.url ?? '/';

    // U13 / R26: refuse known secret/debug leak paths (.env, .git/, *.map,
    // /__nextjs_*) BEFORE proxying upstream. Returns 404 (not 403) so we don't
    // confirm the resource exists to a probing client.
    if (isSensitivePath(reqUrl)) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }

    const options: RequestOptions = {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (target.protocol === 'https:' ? 443 : 80),
      method: req.method,
      path: reqUrl,
      headers: buildUpstreamHeaders(req),
    };

    const upstreamReq = transport.request(options, (upstreamRes) => {
      const status = upstreamRes.statusCode ?? 502;
      const contentType = upstreamRes.headers['content-type'];
      const inject = isInjectableHtml(contentType) && req.method !== 'HEAD';

      // Build downstream headers, dropping hop-by-hop. If injecting, drop the
      // stale Content-Length (body length changes) and rewrite CSP.
      const outHeaders: Record<string, string | string[]> = {};
      for (const [key, value] of Object.entries(upstreamRes.headers)) {
        if (value === undefined) continue;
        const lower = key.toLowerCase();
        if (HOP_BY_HOP.has(lower)) continue;
        if (inject && lower === 'content-length') continue;
        if (CSP_HEADER_NAMES.includes(lower as (typeof CSP_HEADER_NAMES)[number])) {
          const v = Array.isArray(value) ? value.join(', ') : value;
          outHeaders[key] = rewriteCsp(v, {
            nonce,
            connectOrigin: config.backendOrigin,
          });
          continue;
        }
        outHeaders[key] = value;
      }

      res.writeHead(status, outHeaders);

      if (inject) {
        const transform = new InjectTransform({ snippet: scriptTag });
        upstreamRes.pipe(transform).pipe(res);
        transform.on('error', () => res.destroy());
      } else {
        // Pass-through verbatim: JSON / JS / CSS / SSE / images / error bodies.
        upstreamRes.pipe(res);
      }
      upstreamRes.on('error', () => res.destroy());
    });

    upstreamReq.on('error', (err) => {
      if (!res.headersSent) {
        res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      }
      res.end(`SuperComment proxy: upstream error: ${(err as Error).message}`);
    });

    // Stream the request body upstream (POST/PUT/etc.).
    req.pipe(upstreamReq);
    req.on('error', () => upstreamReq.destroy());
  };

  // WebSocket / HMR passthrough. Vite & Next dev HMR open a WS via HTTP Upgrade;
  // we open a raw TCP connection to the upstream, replay the upgrade request, and
  // pipe both directions. We forward identity (no Accept-Encoding strip needed on
  // WS) and set X-Forwarded-Proto so secure-context HMR clients are satisfied.
  //
  // VERIFY IN REAL ENV: HMR end-to-end through a real Vite and a real Next.js dev
  // server (browser reconnect, fast refresh) cannot be exercised in this unit's
  // tests — they assert the upgrade handler is wired and forwards bytes against a
  // mock upstream socket. Manual verification against live dev servers is
  // required (plan U3 "Verification").
  const handleUpgrade = (
    req: IncomingMessage,
    socket: net.Socket,
    head: Buffer,
  ): void => {
    const upstream = net.connect(
      Number(target.port) || (target.protocol === 'https:' ? 443 : 80),
      target.hostname,
    );

    upstream.on('connect', () => {
      // Re-serialize the upgrade request line + headers to the upstream.
      const headerLines: string[] = [`${req.method} ${req.url} HTTP/1.1`];
      const headers = { ...req.headers };
      headers['host'] = target.host;
      (headers as Record<string, string>)['x-forwarded-proto'] = 'https';
      for (const [key, value] of Object.entries(headers)) {
        if (value === undefined) continue;
        if (Array.isArray(value)) {
          for (const v of value) headerLines.push(`${key}: ${v}`);
        } else {
          headerLines.push(`${key}: ${value}`);
        }
      }
      upstream.write(headerLines.join('\r\n') + '\r\n\r\n');
      if (head && head.length > 0) upstream.write(head);

      // Bidirectional pipe; the upstream's 101 response + frames flow back to the
      // client untouched.
      upstream.pipe(socket);
      socket.pipe(upstream);
    });

    const teardown = (): void => {
      socket.destroy();
      upstream.destroy();
    };
    upstream.on('error', teardown);
    socket.on('error', teardown);
  };

  const attach = (server: http.Server): void => {
    server.on('request', handleRequest);
    server.on('upgrade', handleUpgrade);
  };

  const listen = (port: number, hostname = '127.0.0.1'): http.Server => {
    const server = http.createServer();
    attach(server);
    server.listen(port, hostname);
    return server;
  };

  return { handleRequest, handleUpgrade, nonce, listen, attach };
}
