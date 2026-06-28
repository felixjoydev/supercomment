/**
 * Overlay static-asset delivery helpers (U1).
 *
 * The overlay IIFE is content-hashed at build time and copied into
 * `apps/web/public/sc/` by the `prebuild` step (scripts/copy-overlay.mjs), so
 * Next serves it as an immutable static asset at
 * `/sc/overlay.<hash>.global.js` (immutable header wired in next.config.ts).
 * The `/sc-loader` route (served `no-store`) reads the current hashed name from
 * the build manifest and emits a tiny snippet that injects the bundle onto the
 * customer's page cross-origin.
 *
 * SCOPE: this unit is the delivery floor only.
 *  - U3 will extend the loader to read + strip the activation token; the
 *    overlay stays dormant until then.
 *  - U11 owns build-time env-gating (preview-only) + CSP guidance.
 * No activation logic lives here.
 */

/** Public path prefix the hashed bundle is served from. */
export const OVERLAY_ASSET_BASE = "/sc";

/** Shape of the build manifest the loader reads. */
export interface OverlayManifest {
  /** Current content-hashed bundle filename, e.g. "overlay.<hash>.global.js". */
  overlay: string;
}

/**
 * Validate a manifest object and return the same-origin path to the hashed
 * bundle (e.g. "/sc/overlay.<hash>.global.js"). Throws a clear error when the
 * manifest is missing/malformed so the loader fails loudly instead of serving
 * an empty 200.
 */
export function resolveOverlayBundlePath(manifest: unknown): string {
  const name =
    manifest && typeof manifest === "object"
      ? (manifest as { overlay?: unknown }).overlay
      : undefined;
  if (typeof name !== "string" || name.length === 0) {
    throw new Error(
      'overlay manifest is missing the "overlay" entry — run the web prebuild ' +
        "(scripts/copy-overlay.mjs) after building the overlay.",
    );
  }
  // Defensive: the manifest must name a single file, never a path/URL traversal.
  if (name.includes("/") || name.includes("\\") || name.includes("..")) {
    throw new Error(`invalid overlay bundle name in manifest: ${name}`);
  }
  return `${OVERLAY_ASSET_BASE}/${name}`;
}

/**
 * Build the tiny loader snippet. It runs on the *customer's* origin, so
 * `bundleUrl` is absolute (points back at the SuperComment host). Idempotent:
 * a second load is a no-op.
 */
export function buildLoaderScript(bundleUrl: string): string {
  // U3 will add synchronous token read + history.replaceState strip BEFORE
  // injecting the bundle (so error reporters never capture the token).
  return [
    "(function () {",
    "  if (window.__SUPERCOMMENT_LOADER__) return;",
    "  window.__SUPERCOMMENT_LOADER__ = true;",
    "  var s = document.createElement('script');",
    `  s.src = ${JSON.stringify(bundleUrl)};`,
    "  s.async = true;",
    "  (document.head || document.documentElement).appendChild(s);",
    "})();",
    "",
  ].join("\n");
}

/**
 * Build the full `/sc-loader` HTTP response: the loader snippet as JS, served
 * `no-store` (the hashed bundle behind it is the immutable layer). `origin` is
 * the SuperComment host (derived from the request) so the injected bundle URL
 * is absolute and resolves cross-origin from the customer's page.
 *
 * Throws (via resolveOverlayBundlePath) on a missing/invalid manifest; the
 * route maps that to a clear 500 rather than an empty 200.
 */
export function buildLoaderResponse(manifest: unknown, origin: string): Response {
  const bundleUrl = `${origin}${resolveOverlayBundlePath(manifest)}`;
  return new Response(buildLoaderScript(bundleUrl), {
    status: 200,
    headers: {
      "content-type": "text/javascript; charset=utf-8",
      // The loader is the indirection layer; never cache it so a redeploy's new
      // hash is picked up immediately. The bundle itself is immutable.
      "cache-control": "no-store",
    },
  });
}
