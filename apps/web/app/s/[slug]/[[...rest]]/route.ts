import { NextResponse, type NextRequest } from 'next/server';
import { createClient as createAnonClient } from '@supabase/supabase-js';

/**
 * Stable preview link: `…/s/<slug>/<anything>` (U4 backend half).
 *
 * The developer shares ONE stable URL; the underlying cloudflared tunnel URL
 * changes every `supercomment start`. This catch-all route resolves the slug to
 * the preview's CURRENT tunnel URL (via the anon-granted resolve_tunnel_for_slug
 * RPC) and reverse-proxies the request — any method, any sub-path, including the
 * overlay/boot scripts the CLI's front server serves — so reviewers always reach
 * the live app through the constant link. The tunnel already serves the page
 * with the overlay injected (U3/U4 CLI side), so we just forward bytes.
 *
 * When the preview is offline (no live tunnel) we return a clear "not live"
 * page rather than a confusing proxy error. Serving the latest SNAPSHOT here is
 * U11 (offline serving) — deliberately out of scope for this route today.
 *
 * NOTE: WebSocket upgrades (HMR) are NOT proxied through this Next route — the
 * Node serverless/runtime request model here is request/response only. For full
 * HMR fidelity a reviewer can hit the raw tunnel URL; the stable link covers
 * normal HTTP review traffic. (Documented limitation; revisit with a dedicated
 * proxy server if needed.)
 */

export const dynamic = 'force-dynamic';

interface TunnelRoute {
  preview_id: string;
  current_tunnel_url: string | null;
  status: 'live' | 'offline';
  access_mode: 'team_only' | 'guest_link';
  expires_at: string | null;
}

function anonClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY');
  }
  // No session/cookies needed: resolve_tunnel_for_slug is anon-executable and
  // returns only routing fields.
  return createAnonClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function offlinePage(message: string, status = 503): Response {
  const html = `<!doctype html><html><head><meta charset="utf-8">
<title>SuperComment — preview offline</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1.5rem;color:#1f2937}
h1{font-size:1.25rem}code{background:#f3f4f6;padding:2px 6px;border-radius:4px}</style>
</head><body><h1>This preview isn't live right now</h1>
<p>${message}</p>
<p>The developer needs to run <code>supercomment start</code> to share it again.</p>
</body></html>`;
  return new NextResponse(html, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

async function resolve(slug: string): Promise<TunnelRoute | null> {
  const supabase = anonClient();
  const { data, error } = await supabase.rpc('resolve_tunnel_for_slug', { p_slug: slug });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as TunnelRoute | undefined;
  return row ?? null;
}

/** Hop-by-hop headers we must not forward (RFC 7230 §6.1). */
const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade', 'host', 'content-length',
]);

async function handle(
  request: NextRequest,
  ctx: { params: Promise<{ slug: string; rest?: string[] }> },
): Promise<Response> {
  const { slug, rest } = await ctx.params;

  let route: TunnelRoute | null;
  try {
    route = await resolve(slug);
  } catch {
    return offlinePage('We could not look up this preview.', 502);
  }

  if (!route) {
    return new NextResponse('Preview not found.', { status: 404 });
  }
  if (route.expires_at && new Date(route.expires_at).getTime() < Date.now()) {
    return offlinePage('This share link has expired.');
  }
  if (route.status !== 'live' || !route.current_tunnel_url) {
    return offlinePage('The developer is currently offline.');
  }

  // Build the upstream URL: tunnel origin + the path after /s/<slug> + query.
  const base = route.current_tunnel_url.replace(/\/+$/, '');
  const subPath = rest && rest.length > 0 ? '/' + rest.join('/') : '/';
  const search = request.nextUrl.search ?? '';
  const upstreamUrl = `${base}${subPath}${search}`;

  // Forward the request, stripping hop-by-hop + Accept-Encoding (so the tunnel
  // returns identity-encoded bytes we can stream straight back).
  const fwdHeaders = new Headers();
  request.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP.has(lower) || lower === 'accept-encoding') return;
    fwdHeaders.set(key, value);
  });

  const method = request.method;
  const hasBody = method !== 'GET' && method !== 'HEAD';

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method,
      headers: fwdHeaders,
      ...(hasBody ? { body: await request.arrayBuffer() } : {}),
      redirect: 'manual',
    });
  } catch {
    return offlinePage('The developer went offline mid-session.');
  }

  // Pass the upstream response straight back, dropping hop-by-hop headers.
  const outHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    if (HOP_BY_HOP.has(key.toLowerCase())) return;
    outHeaders.set(key, value);
  });

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: outHeaders,
  });
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const HEAD = handle;
export const OPTIONS = handle;
