import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    // A type error is a build failure. Never flip this to true.
    ignoreBuildErrors: false,
  },
  // Note: there is no `eslint` key in Next 16's config type — linting runs as its
  // own blocking `npm run lint` step and is not part of `next build`.
  // Do not advertise the framework and its version on every response.
  poweredByHeader: false,
  // Audit finding 12: this was `false`, which hides double-invocation bugs
  // (effects that are not idempotent, stale fetches, missing cleanups) until
  // production. Development-only behaviour; it does not affect the prod build.
  reactStrictMode: true,
};

export default nextConfig;
