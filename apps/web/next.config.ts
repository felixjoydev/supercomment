import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Consume the shared workspace package directly from source.
  transpilePackages: ["@supercomment/shared"],

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
