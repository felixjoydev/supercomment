import manifest from "../../lib/overlay-manifest.json";
import { buildLoaderResponse } from "../../lib/overlay-asset";

// Never statically optimized: the loader is the no-store indirection layer in
// front of the immutable, content-hashed overlay bundle.
export const dynamic = "force-dynamic";

/**
 * GET /sc-loader — the stable URL a customer's <script> points at (see
 * docs/embed/install.md). Emits a tiny snippet, served `no-store`, that injects
 * the current hashed overlay bundle from this host (`/sc/overlay.<hash>...`).
 *
 * The hashed name is read from the build manifest (apps/web/lib/overlay-manifest.json,
 * written by scripts/copy-overlay.mjs) imported at build time — no request-time
 * filesystem read. U3 adds token activation; U11 adds prod env-gating + CSP.
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
