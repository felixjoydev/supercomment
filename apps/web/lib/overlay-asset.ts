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
 * U11 finalizes this module:
 *  - BOOT CONFIG DELIVERY (closes the U3 gap): the loader now emits
 *    `window.__SUPERCOMMENT__ = { supabaseUrl, supabaseAnonKey, backendOrigin,
 *    turnstileSiteKey }` BEFORE the bundle <script>, so the embedded overlay can
 *    anon-sign-in → exchange the review token → activate (U3). Values come from
 *    the SuperComment host's NEXT_PUBLIC_* env (anon key is public by design) and
 *    the request origin (the app IS the backend the overlay calls back to).
 *  - PRODUCTION SAFETY (R18) layer 1 — build-time: on production deploys
 *    (`NEXT_PUBLIC_VERCEL_ENV === "production"`, no explicit opt-in) the loader is
 *    INERT — it injects no overlay and logs a console note. Layer 2 is the
 *    overlay's own dormant-without-token runtime gate (U3, in the bundle).
 *
 * The activation/token logic itself lives in the overlay bundle (U3), not here;
 * this module only delivers the boot config + bundle (or an inert no-op). See
 * docs/embed/install.md for the install, env, and CSP guidance.
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
 * The boot config the loader writes to `window.__SUPERCOMMENT__`, read by the
 * embedded overlay (see apps/overlay/src/index.ts `InjectedBootConfig`). All
 * values are PUBLIC by design: the anon key is publishable (RLS is the security
 * boundary). NEVER place service_role or the Turnstile SECRET here — only the
 * client-safe NEXT_PUBLIC_* values and the (public) request origin.
 */
export interface LoaderBootConfig {
  /** Supabase project URL — anon sign-in / refresh / RPC target. */
  supabaseUrl?: string;
  /** Supabase anon/publishable key (public by design). */
  supabaseAnonKey?: string;
  /** The SuperComment host the overlay POSTs the token exchange to. */
  backendOrigin?: string;
  /** Cloudflare Turnstile site key (public). Absent → overlay sends no token. */
  turnstileSiteKey?: string;
}

/**
 * Assemble the boot config from the SuperComment host's environment + the request
 * origin. `origin` is the SuperComment host (the app IS the token-exchange
 * backend, so `backendOrigin` is always set). Supabase/Turnstile keys are omitted
 * when unset so the overlay degrades gracefully (no url/key → stays dormant; no
 * site key → no Turnstile token, i.e. dev/demo).
 */
export function bootConfigFromEnv(
  origin: string,
  env: Record<string, string | undefined> = process.env,
): LoaderBootConfig {
  const config: LoaderBootConfig = { backendOrigin: origin };
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const turnstileSiteKey = env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  if (supabaseUrl) config.supabaseUrl = supabaseUrl;
  if (supabaseAnonKey) config.supabaseAnonKey = supabaseAnonKey;
  if (turnstileSiteKey) config.turnstileSiteKey = turnstileSiteKey;
  return config;
}

/** Env var that opts a production deploy back into serving the overlay. */
export const PROD_OPT_IN_ENV = "SUPERCOMMENT_ENABLE_IN_PROD";

/**
 * Production safety (R18) layer 1: whether the loader should serve the overlay at
 * all. The embedded overlay is a preview/staging tool, so production deploys are
 * INERT by default. An explicit opt-in (`SUPERCOMMENT_ENABLE_IN_PROD=1`) re-enables
 * it for the rare non-public "staging deployed as production" case. Everything
 * non-production (preview, development, unset) is enabled.
 */
export function isLoaderEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (env[PROD_OPT_IN_ENV] === "1") return true;
  return env.NEXT_PUBLIC_VERCEL_ENV !== "production";
}

/**
 * Build the tiny loader snippet. It runs on the *customer's* origin, so
 * `bundleUrl` is absolute (points back at the SuperComment host). The boot config
 * is assigned to `window.__SUPERCOMMENT__` FIRST (so the overlay sees it the
 * moment the bundle runs), THEN the bundle <script> is injected. Idempotent: a
 * second load is a no-op. (The overlay bundle does its own synchronous token
 * read + `history.replaceState` strip on boot — U3.)
 */
export function buildLoaderScript(
  bundleUrl: string,
  bootConfig: LoaderBootConfig,
): string {
  // JSON-encode to neutralize injection; `Object.assign` merges so a host that
  // pre-sets fields isn't clobbered (mirrors the CLI tunnel boot script).
  const bootJson = JSON.stringify(bootConfig);
  return [
    "(function () {",
    "  if (window.__SUPERCOMMENT_LOADER__) return;",
    "  window.__SUPERCOMMENT_LOADER__ = true;",
    `  window.__SUPERCOMMENT__ = Object.assign(window.__SUPERCOMMENT__ || {}, ${bootJson});`,
    "  var s = document.createElement('script');",
    `  s.src = ${JSON.stringify(bundleUrl)};`,
    "  s.async = true;",
    "  (document.head || document.documentElement).appendChild(s);",
    "})();",
    "",
  ].join("\n");
}

/**
 * The inert loader served on production deploys (R18 layer 1). Injects nothing
 * and logs a single console note so an operator who left the snippet in a prod
 * build can see why no overlay appeared. Still a valid 200 JS body so the
 * customer's <script> tag never errors.
 */
export function buildInertLoaderScript(): string {
  return [
    "(function () {",
    "  if (window.__SUPERCOMMENT_LOADER__) return;",
    "  window.__SUPERCOMMENT_LOADER__ = true;",
    '  if (typeof console !== "undefined" && console.info) {',
    "    console.info(" +
      JSON.stringify(
        "[SuperComment] overlay loader is inert on this production deploy; no " +
          "overlay injected. Include the snippet only in preview/staging builds " +
          "(see docs/embed/install.md), or set SUPERCOMMENT_ENABLE_IN_PROD=1 to " +
          "override for a non-public staging-as-production environment.",
      ) +
      ");",
    "  }",
    "})();",
    "",
  ].join("\n");
}

/**
 * Build the full `/sc-loader` HTTP response: the loader snippet as JS, served
 * `no-store` (the hashed bundle behind it is the immutable layer). `origin` is
 * the SuperComment host (derived from the request) so the injected bundle URL is
 * absolute and resolves cross-origin from the customer's page; it is also the
 * overlay's `backendOrigin` for the token exchange.
 *
 * Production safety (R18) layer 1: on a production deploy (no opt-in) the body is
 * an inert no-op — and we deliberately do NOT read the manifest in that branch,
 * so a production deploy never 500s on a missing overlay build, it just no-ops.
 *
 * When enabled, throws (via resolveOverlayBundlePath) on a missing/invalid
 * manifest; the route maps that to a clear 500 rather than an empty 200.
 */
export function buildLoaderResponse(
  manifest: unknown,
  origin: string,
  env: Record<string, string | undefined> = process.env,
): Response {
  const body = isLoaderEnabled(env)
    ? buildLoaderScript(
        `${origin}${resolveOverlayBundlePath(manifest)}`,
        bootConfigFromEnv(origin, env),
      )
    : buildInertLoaderScript();

  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/javascript; charset=utf-8",
      // The loader is the indirection layer; never cache it so a redeploy's new
      // hash (or a flip in env-gating) is picked up immediately. The bundle
      // itself is immutable.
      "cache-control": "no-store",
    },
  });
}
