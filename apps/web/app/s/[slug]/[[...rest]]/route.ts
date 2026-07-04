import { NextResponse, type NextRequest } from 'next/server';
import { createClient as createAnonClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { safeNextPath } from '@/lib/safe-redirect';
import { requireMember, type VerifiedClaims } from '@/lib/auth-guard';
import {
  classifyMintError,
  generateReviewToken,
  buildEmbeddedRedirectUrl,
} from '@/lib/share-access';
import {
  buildForwardHeaders,
  buildTunnelResponseHeaders,
  stripLinkSecretFromSearch,
} from '@/lib/proxy-headers';
import { isWebTunnelEnabled } from '@/lib/tunnel-gate';

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
  subPath?: string,
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
        // Carry the deep-linked page through login so the member returns to it.
        const next = safeNextPath(subPath ? `/s/${slug}${subPath}` : `/s/${slug}`);
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

  const target = buildEmbeddedRedirectUrl(row.deploy_url, row.token ?? token, subPath);
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

/**
 * team_only tunnel access: verify the caller is a verified, non-anonymous member
 * of the preview's workspace (via the cookie-bound client — their first-party
 * cookies ride every same-origin /s asset request). Returns a Response to
 * short-circuit when access is denied, or null when the member may proceed.
 * Anonymous/no session on a navigable hit is bounced through login, mirroring
 * the embedded `login_required` path.
 */
async function requireTunnelMember(
  request: NextRequest,
  previewId: string,
  slug: string,
): Promise<Response | null> {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = (claimsData?.claims ?? null) as VerifiedClaims | null;

  if (!claims?.sub || claims.is_anonymous === true) {
    if (request.method === 'GET' || request.method === 'HEAD') {
      const next = safeNextPath(`/s/${slug}`);
      return NextResponse.redirect(
        new URL(`/login?next=${encodeURIComponent(next)}`, request.nextUrl.origin),
        { status: 307 },
      );
    }
    return infoPage('You must sign in to view this preview.', 401);
  }

  const { data: isMember } = await supabase.rpc('is_preview_workspace_member', {
    p_preview_id: previewId,
  });
  const guard = requireMember(claims, isMember === true);
  if (!guard.ok) {
    return infoPage('You do not have access to this preview.', guard.status);
  }
  return null;
}

async function proxyTunnel(
  request: NextRequest,
  slug: string,
  rest: string[] | undefined,
): Promise<Response> {
  // H1: the hosted tunnel reverse proxy is legacy/dormant and stays OFF unless
  // the deployment opts in via SUPERCOMMENT_ENABLE_TUNNEL. Default off means an
  // attacker-registered tunnel is never served same-origin as the dashboard.
  if (!isWebTunnelEnabled()) {
    return infoPage("This preview isn't available.", 404);
  }

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

  // H1: enforce access BEFORE forwarding. team_only requires a signed-in member;
  // resolve_tunnel_for_slug deliberately never returns link_secret, so guest_link
  // access rests on the secret-in-link plus the opaque-origin sandbox applied to
  // the response below (buildTunnelResponseHeaders).
  if (route.access_mode === 'team_only') {
    const denied = await requireTunnelMember(request, route.preview_id, slug);
    if (denied) return denied;
  }

  const base = route.current_tunnel_url.replace(/\/+$/, '');
  const subPath = rest && rest.length > 0 ? '/' + rest.join('/') : '/';
  // Drop the ?k= link secret so it never reaches the developer's tunnel origin.
  const search = stripLinkSecretFromSearch(request.nextUrl.search ?? '');
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

  // Strip upstream Set-Cookie (no dashboard-origin cookie overwrite) and force
  // the opaque-origin sandbox CSP so proxied scripts can't touch the dashboard's
  // same-origin session (the H1 same-origin-XSS fix).
  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: buildTunnelResponseHeaders(upstream.headers),
  });
}

async function handle(
  request: NextRequest,
  ctx: { params: Promise<{ slug: string; rest?: string[] }> },
): Promise<Response> {
  const { slug, rest } = await ctx.params;

  // Embedded activation applies to the root hit AND to a per-page deep link
  // (/s/<slug><path>, U10): mint first-party and redirect to that page of the
  // customer's deploy. A non-embedded (tunnel) preview raises not_embeddable, so
  // tryEmbedded returns null and we fall through to the dormant tunnel proxy with
  // sub-asset behavior unchanged.
  const subPath = rest && rest.length > 0 ? '/' + rest.join('/') : undefined;
  if (request.method === 'GET' || request.method === 'HEAD') {
    const embedded = await tryEmbedded(request, slug, subPath);
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
