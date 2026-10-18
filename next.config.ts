import type { NextConfig } from 'next'

const socketInternal = process.env.SOCKET_INTERNAL_URL || 'http://127.0.0.1:3003'

const nextConfig: NextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ['better-sqlite3'],
  experimental: {
    // src/proxy.ts runs on every request, and Next buffers request bodies for it
    // with a 10 MB default cap. Anything larger (phone videos, big photos) was
    // truncated → "Failed to parse body as FormData". Match the upload route's 50 MB.
    proxyClientMaxBodySize: '55mb',
  },
  async rewrites() {
    return [
      {
        source: '/socket.io/:path*',
        destination: `${socketInternal}/socket.io/:path*`,
      },
    ]
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), geolocation=()' },
          { key: 'X-DNS-Prefetch-Control', value: 'off' },
        ],
      },
    ]
  },
}

export default nextConfig
