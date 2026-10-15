import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function proxy(request: NextRequest) {
  const actionHeader = request.headers.get('next-action')

  // Reject dummy probe headers
  if (actionHeader === 'x' || (actionHeader && actionHeader.length < 10)) {
    return new NextResponse('Invalid Server Action', { status: 400 })
  }

  return NextResponse.next()
}

export const config = {
  matcher: '/:path*',
}
