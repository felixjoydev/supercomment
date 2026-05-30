import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Consume the shared workspace package directly from source.
  transpilePackages: ["@supercomment/shared"],
};

export default nextConfig;
