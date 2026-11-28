import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * Response security headers.
 *
 * These previously lived only in `Caddyfile.production`. Every path that does
 * not sit behind that specific reverse proxy — `npm start`, the Playwright suite,
 * the Docker image served directly, a host with its own nginx — therefore served
 * no `X-Frame-Options`, no `Referrer-Policy` and no `nosniff`. Setting them here
 * makes the application itself carry its security contract, and Caddy stays a
 * second line of defence rather than the only one.
 *
 * Audit finding 11 also removed the blanket `host.endsWith('.e2b.app')`
 * exception: trusting a hostname suffix meant any deployment that happened to
 * terminate on that domain silently lost clickjacking protection. Framing is now
 * controlled only by an explicit operator setting.
 */

/** Set to "true" to allow this deployment to be embedded in a frame. */
const ALLOW_FRAME_PREVIEW = process.env.ALLOW_FRAME_PREVIEW === 'true'

/**
 * Content-Security-Policy.
 *
 * `'unsafe-inline'` for styles is required by the UI library's runtime style
 * injection and `'unsafe-eval'` by the WebRTC/media tooling; both are recorded
 * here rather than hidden. `connect-src` must allow `wss:` because realtime runs
 * on the same origin but over a websocket upgrade.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob:",
  "connect-src 'self' ws: wss: https:",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  // frame-ancestors is the modern equivalent of X-Frame-Options; both are sent
  // so older browsers and newer ones reach the same decision.
  ALLOW_FRAME_PREVIEW ? "frame-ancestors *" : "frame-ancestors 'none'",
].join('; ')

export function proxy(request: NextRequest) {
  const res = NextResponse.next()

  res.headers.set('X-Content-Type-Options', 'nosniff')
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.headers.set('Content-Security-Policy', CONTENT_SECURITY_POLICY)
  res.headers.set(
    'Permissions-Policy',
    'camera=(self), microphone=(self), display-capture=(self), geolocation=(self)',
  )
  // No `X-Powered-By: Next.js` and no framework version disclosure.
  res.headers.set('X-Powered-By', '')
  if (!ALLOW_FRAME_PREVIEW) {
    res.headers.set('X-Frame-Options', 'DENY')
  }

  // API responses carry user-specific data and must never be stored by a shared
  // cache. Route handlers can still override this for callers that need
  // something narrower (e.g. `/api/files/[id]` sends its own `no-store`).
  if (request.nextUrl.pathname.startsWith('/api/')) {
    res.headers.set('Cache-Control', 'no-store')
  }

  return res
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
