import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function proxy(request: NextRequest) {
  const res = NextResponse.next()
  res.headers.set('X-Content-Type-Options', 'nosniff')
  const host = (request.headers.get('x-forwarded-host') || request.headers.get('host') || '').split(':')[0].toLowerCase()
  const isPreviewHost = host.endsWith('.e2b.app') || process.env.ALLOW_FRAME_PREVIEW === 'true'
  if (!isPreviewHost) {
    res.headers.set('X-Frame-Options', 'DENY')
  }
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  if (request.nextUrl.pathname.startsWith('/api/')) {
    res.headers.set('Cache-Control', 'no-store')
  }
  return res
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
