import type { NextConfig } from "next";

/**
 * U5 source-stamp gating (kept in sync with babel.config.js).
 *
 * `data-sc-source` is stamped by Babel ONLY in preview builds. The actual
 * plugin wiring lives in babel.config.js (Next 16 Turbopack auto-detects it and
 * runs Babel — see the SWC-vs-Babel tradeoff note there). This file owns the
 * production backstop: when we are NOT stamping, SWC strips any stray
 * `data-sc-source` attribute via `compiler.reactRemoveProperties` so production
 * never ships source paths even if a stamp slips through. In preview we leave
 * the attribute intact so the overlay can read it.
 *
 * NOTE (real-env, U11 finalizes): `reactRemoveProperties` is an SWC transform;
 * verify it runs under Turbopack's builtin-babel mode for true production
 * builds. U11 owns the complete prod-safety + CSP story.
 */
const SC_SOURCE_STAMP =
  process.env.SC_SOURCE_STAMP === "1" ||
  process.env.NEXT_PUBLIC_VERCEL_ENV === "preview";

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
    ];
  },
};

export default nextConfig;
