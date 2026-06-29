import { NextResponse, type NextRequest } from 'next/server';
import { createClient as createAnonClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { safeNextPath } from '@/lib/safe-redirect';
import {
  classifyMintError,
  generateReviewToken,
  buildEmbeddedRedirectUrl,
} from '@/lib/share-access';
import { HOP_BY_HOP, buildForwardHeaders } from '@/lib/proxy-headers';

/**
 * Stable preview link: `…/s/<slug>/<anything>`.
 *
 * EMBEDDED MODE (U2, primary): when the preview has a registered `deploy_url`,
 * we resolve identity FIRST-PARTY here (member via the cookie-bound session vs
 * guest via the link secret), mint a short-lived single-use preview-scoped token
 * server-side (mint_review_token), and 307-redirect the reviewer to their own
 * deployed preview with the token in the URL FRAGMENT. The overlay embedded in
 * that deploy exchanges the token for a scoped session (U3). The guest secret is
 * validated here and NEVER forwarded to the deploy origin.
 *
 * TUNNEL MODE (legacy, dormant): when the preview has NO deploy_url, we fall
 * back to the original reverse-proxy of the current cloudflared tunnel URL. This
 * path is retained for the (flag-gated, U10) tunnel mode and is otherwise unused.
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
  return createAnonClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function infoPage(message: string, status = 503): Response {
  const html = `<!doctype html><html><head><meta charset="utf-8">
<title>SuperComment — preview</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1.5rem;color:#1f2937}
h1{font-size:1.25rem}code{background:#f3f4f6;padding:2px 6px;border-radius:4px}</style>
</head><body><h1>This preview isn't available</h1>
<p>${message}</p></body></html>`;
  return new NextResponse(html, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

/**
 * Embedded activation: mint a token (first-party) and redirect to the deploy
 * URL with it in the fragment. Returns null to signal "not embedded — use the
 * tunnel fallback"; throws nothing (errors map to responses).
 */
async function tryEmbedded(
  request: NextRequest,
  slug: string,
): Promise<Response | null> {
  const k = request.nextUrl.searchParams.get('k');
  const token = generateReviewToken();

  // TODO(U4): durable per-slug+IP rate limit on minting (in-memory is useless in
  // serverless). The 90s single-use token + Turnstile-gated exchange (U4) bound
  // the blast radius until then.
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('mint_review_token', {
    p_slug: slug,
    p_token: token,
    p_link_secret: k,
  });

  if (error) {
    const outcome = classifyMintError(error.message);
    switch (outcome) {
      case 'not_embeddable':
        return null; // fall back to tunnel mode
      case 'login_required': {
        const next = safeNextPath(`/s/${slug}`);
        return NextResponse.redirect(
          new URL(`/login?next=${encodeURIComponent(next)}`, request.nextUrl.origin),
          { status: 307 },
        );
      }
      case 'link_expired':
        return infoPage('This share link has expired.');
      case 'preview_not_found':
        return new NextResponse('Preview not found.', { status: 404 });
      case 'access_denied':
        return infoPage('You do not have access to this preview.', 403);
      default:
        return infoPage('We could not open this preview.', 502);
    }
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | { token: string; deploy_url: string; role: string }
    | undefined;
  if (!row?.deploy_url) return null;

  const target = buildEmbeddedRedirectUrl(row.deploy_url, row.token ?? token);
  if (!target) {
    return infoPage('This preview has an invalid deploy target.', 502);
  }
  // 307 to the deploy origin; token in the fragment; no Referer to the target.
  return new NextResponse(null, {
    status: 307,
    headers: { location: target, 'referrer-policy': 'no-referrer' },
  });
}

// ---------------------------------------------------------------------------
// TUNNEL MODE (legacy reverse proxy) — retained for the dormant tunnel path.
// HOP_BY_HOP + the forwarded-request header strip (which also drops the
// reviewer's first-party credentials: authorization / cookie / sb-*) live in
// @/lib/proxy-headers so they are unit-tested without next/server.
// ---------------------------------------------------------------------------

async function resolveTunnel(slug: string): Promise<TunnelRoute | null> {
  const supabase = anonClient();
  const { data, error } = await supabase.rpc('resolve_tunnel_for_slug', { p_slug: slug });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as TunnelRoute | undefined;
  return row ?? null;
}

async function proxyTunnel(
  request: NextRequest,
  slug: string,
  rest: string[] | undefined,
): Promise<Response> {
  let route: TunnelRoute | null;
  try {
    route = await resolveTunnel(slug);
  } catch {
    return infoPage('We could not look up this preview.', 502);
  }
  if (!route) return new NextResponse('Preview not found.', { status: 404 });
  if (route.expires_at && new Date(route.expires_at).getTime() < Date.now()) {
    return infoPage('This share link has expired.');
  }
  if (route.status !== 'live' || !route.current_tunnel_url) {
    return infoPage('The developer is currently offline.');
  }

  const base = route.current_tunnel_url.replace(/\/+$/, '');
  const subPath = rest && rest.length > 0 ? '/' + rest.join('/') : '/';
  const search = request.nextUrl.search ?? '';
  const upstreamUrl = `${base}${subPath}${search}`;

  // Strip hop-by-hop + accept-encoding AND the reviewer's first-party
  // credentials (authorization / cookie / sb-*) so a signed-in member's session
  // never leaks to the developer-controlled tunnel origin (the plan-001 fix).
  const fwdHeaders = buildForwardHeaders(request.headers);

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
    return infoPage('The developer went offline mid-session.');
  }

  const outHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    if (HOP_BY_HOP.has(key.toLowerCase())) return;
    outHeaders.set(key, value);
  });

  return new NextResponse(upstream.body, { status: upstream.status, headers: outHeaders });
}

async function handle(
  request: NextRequest,
  ctx: { params: Promise<{ slug: string; rest?: string[] }> },
): Promise<Response> {
  const { slug, rest } = await ctx.params;

  // Embedded mode only applies to the root activation hit, not sub-asset paths
  // (those only exist in tunnel mode). For embedded previews, sub-paths are
  // served by the customer's own deploy, not us.
  const isRootHit = !rest || rest.length === 0;
  if (isRootHit && (request.method === 'GET' || request.method === 'HEAD')) {
    const embedded = await tryEmbedded(request, slug);
    if (embedded) return embedded;
  }

  return proxyTunnel(request, slug, rest);
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const HEAD = handle;
export const OPTIONS = handle;
