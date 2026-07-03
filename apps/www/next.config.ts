import type { NextConfig } from "next";

/**
 * SuperComment marketing site (apps/www).
 *
 * Every marketing route is statically generated (no dynamic APIs in pages), so
 * AI crawlers see full HTML. Two behaviors live here:
 *
 *  1. www -> apex 301 (canonical host is https://supercomment.dev, no www).
 *  2. /preview/* carries an X-Robots-Tag noindex header as a belt-and-suspenders
 *     partner to the per-page `robots: { index: false }` metadata, so the
 *     side-by-side homepage variants never get indexed.
 */
const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.supercomment.dev" }],
        destination: "https://supercomment.dev/:path*",
        permanent: true,
      },
    ];
  },

  async headers() {
    return [
      {
        source: "/preview/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },
};

export default nextConfig;
