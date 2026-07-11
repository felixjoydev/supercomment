import type { NextConfig } from "next";

/**
 * U5 source-stamp gating — the production backstop.
 *
 * `data-sc-source` is stamped by the Babel plugin in `packages/source-stamp`
 * during PREVIEW builds only (enabled via a Babel config in the preview build;
 * there is no committed babel.config.js here). This file owns the production
 * backstop: when we are NOT stamping, SWC strips any stray
 * `data-sc-source` attribute via `compiler.reactRemoveProperties` so production
 * never ships source paths even if a stamp slips through. In preview we leave
 * the attribute intact so the overlay can read it.
 *
 * This is the `data-sc-source` half of production safety (R18). The overlay half
 * (the /sc-loader boot config + production inert-gating) lives in
 * lib/overlay-asset.ts; the full two-layer prod-safety + CSP story is documented
 * in docs/embed/install.md (U11).
 *
 * REAL-ENV FLAG: `reactRemoveProperties` is an SWC transform; verify it runs
 * under Turbopack's builtin-babel mode for true production builds.
 */
const SC_SOURCE_STAMP =
  process.env.SC_SOURCE_STAMP === "1" ||
  process.env.NEXT_PUBLIC_VERCEL_ENV === "preview";

/** The Supabase project origin, for the image CSP (signed captures load from it). */
const SUPABASE_ORIGIN = (() => {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    return url ? new URL(url).origin : "";
  } catch {
    return "";
  }
})();

/**
 * Dashboard CSP (M5). `frame-ancestors 'none'` is the clickjacking defense; the
 * `img-src` allowlist stops a guest-controlled comment `context.screenshot` /
 * referenceImages value from making a REVIEWING MEMBER's browser fetch an
 * attacker-chosen origin (SSRF + IP/UA/timing leak). Only same-origin, inline
 * data:/blob:, and the Supabase Storage host (signed captures) may load as
 * images. When NEXT_PUBLIC_SUPABASE_URL is unset at build we omit `img-src`
 * rather than block legitimate signed captures. No `default-src`, so scripts /
 * styles / the cross-origin embed surfaces are unaffected.
 * VERIFY IN REAL ENV: confirm no dashboard image loads from another origin.
 */
const DASHBOARD_CSP = SUPABASE_ORIGIN
  ? `frame-ancestors 'none'; img-src 'self' data: blob: ${SUPABASE_ORIGIN}`
  : "frame-ancestors 'none'";

const nextConfig: NextConfig = {
  // Consume the shared workspace package directly from source.
  transpilePackages: ["@supercomment/shared"],

  compiler: {
    // Belt-and-suspenders: strip the build-time source stamp in any non-preview
    // build. `false` in preview keeps the attribute for the overlay to read.
    // Regexes here run in Rust (different syntax from JS RegExp).
    reactRemoveProperties: SC_SOURCE_STAMP
      ? false
      : { properties: ["^data-sc-source$"] },
  },

  // U1: the overlay bundle under /sc/ is content-hashed (overlay.<hash>.global.js)
  // and published into public/sc by the `prebuild` step, so it is safe to cache
  // forever. Files in public/ otherwise get `max-age=0`; promote /sc/ to
  // immutable. The /sc-loader route stays `no-store` (set in its own handler).
  async headers() {
    return [
      {
        source: "/sc/:file*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      {
        // U7: the font catalog is fetched cross-origin by the overlay running on
        // an arbitrary HOST page, so it MUST carry `Access-Control-Allow-Origin`
        // or every catalog fetch fails and the font picker is dead on every host.
        // The generic `/sc/:file*` rule above sends immutable year-long caching
        // and NO ACAO; this MORE-SPECIFIC rule is ordered AFTER it so its headers
        // win on the shared `Cache-Control` key (Next applies later matching rules
        // last) and it adds the ACAO the generic rule lacks. Unlike the immutable,
        // content-hashed bundle, the catalog is a stable path whose contents
        // change between deploys, so it must revalidate rather than cache forever.
        // VERIFY IN REAL ENV (U17): a cross-origin fetch of /sc/fonts-catalog.json
        // returns `Access-Control-Allow-Origin: *` and `must-revalidate`.
        source: "/sc/fonts-catalog.json",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          {
            key: "Cache-Control",
            value: "public, max-age=3600, must-revalidate",
          },
        ],
      },
      {
        // Clickjacking defense (security review, finding 1): no SuperComment
        // dashboard page should ever be framed. This is what stops a malicious
        // site from iframing /cli-auth and clickjacking "Authorize CLI" to ship
        // the live session token to an attacker-chosen loopback port.
        // `frame-ancestors` only governs framing, so it does NOT affect the
        // cross-origin <script> embed surfaces (/sc/*, /sc-loader) or fetch/XHR.
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: DASHBOARD_CSP },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
