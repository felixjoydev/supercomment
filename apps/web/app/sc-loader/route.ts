import manifest from "../../lib/overlay-manifest.json";
import { buildLoaderResponse } from "../../lib/overlay-asset";

// Never statically optimized: the loader is the no-store indirection layer in
// front of the immutable, content-hashed overlay bundle.
export const dynamic = "force-dynamic";

/**
 * GET /sc-loader — the stable URL a customer's <script> points at (see
 * docs/embed/install.md). Emits a tiny snippet, served `no-store`, that assigns
 * the overlay boot config (`window.__SUPERCOMMENT__`) and injects the current
 * hashed overlay bundle from this host (`/sc/overlay.<hash>...`).
 *
 * The hashed name is read from the build manifest (apps/web/lib/overlay-manifest.json,
 * written by scripts/copy-overlay.mjs) imported at build time — no request-time
 * filesystem read.
 *
 * U11 (boot config + prod safety): buildLoaderResponse reads NEXT_PUBLIC_* env at
 * request time (the route is force-dynamic) to assemble the boot config, derives
 * `backendOrigin` from the request origin, and serves an INERT no-op on a
 * production deploy (`NEXT_PUBLIC_VERCEL_ENV === "production"`, unless
 * `SUPERCOMMENT_ENABLE_IN_PROD=1`). The runtime backstop is the overlay's
 * dormant-without-token gate (U3). See docs/embed/install.md for env + CSP.
 *
 * REAL-ENV FLAG: `backendOrigin`/bundle URL derive from `new URL(request.url).origin`;
 * behind a proxy/CDN that must reflect the public host (same derivation U1 uses
 * for the bundle URL, so if the bundle loads, the exchange origin is right).
 */
export function GET(request: Request): Response {
  try {
    const origin = new URL(request.url).origin;
    return buildLoaderResponse(manifest, origin);
  } catch (err) {
    const message = err instanceof Error ? err.message : "overlay unavailable";
    // Clear, non-empty body so a missing/broken build surfaces instead of a
    // silent empty 200.
    return new Response(`/* SuperComment overlay loader error: ${message} */\n`, {
      status: 500,
      headers: {
        "content-type": "text/javascript; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }
}
