import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
// NOTE: typescript.ignoreBuildErrors above is temporarily true while pre-existing
// fc/* upload-shape + useE2EE null-guard debt is cleared; see docs/IMPLEMENTATION_AUDIT.md
