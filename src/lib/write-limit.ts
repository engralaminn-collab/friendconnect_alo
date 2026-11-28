/**
 * Global rate limit for state-changing API requests (audit finding 28).
 *
 * Before this, 83 of 143 mutating route files had no limit at all; only 15 called
 * `rateLimit`. Per-route limits remain where they are stricter (login, OTP, 2FA).
 * This module adds a floor that covers every POST/PUT/PATCH/DELETE under /api/.
 *
 * Bucketing: a signed-in browser is keyed by a hash of its `fc_session` cookie, so
 * one user behind a shared NAT is not throttled with everyone else. Anonymous
 * callers are keyed by the first `x-forwarded-for` hop. That header is only as
 * trustworthy as the reverse proxy in front of the app; deployments must strip it
 * from untrusted clients.
 *
 * The one exemption is the realtime server's callback into `/api/jara/respond`.
 * It is exempt only when it presents the same internal secret that route checks.
 */
import { createHash, timingSafeEqual } from 'crypto'

export const WRITE_LIMIT_MAX = 240
export const WRITE_LIMIT_WINDOW_SECONDS = 60

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const INTERNAL_ROUTE = '/api/jara/respond'

export function isMutatingApiRequest(method: string, pathname: string): boolean {
  return pathname.startsWith('/api/') && MUTATING.has(method.toUpperCase())
}

function resolveInternalSecret(): string {
  return (
    process.env.SOCKET_INTERNAL_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    (process.env.NODE_ENV !== 'production' ? 'friendconnect-dev-secret-change-in-production' : '')
  )
}

/** True only when the header equals the secret the internal route itself accepts. */
export function isInternalCallback(pathname: string, provided: string | null): boolean {
  if (pathname !== INTERNAL_ROUTE || !provided) return false
  const expected = resolveInternalSecret()
  if (!expected) return false
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(provided, 'utf8')
  return a.length === b.length && timingSafeEqual(a, b)
}

/** The bucket key. The session token itself is hashed so it never becomes a cache key. */
export function writeLimitKey(cookieHeader: string | null, forwardedFor: string | null, realIp: string | null): string {
  const match = (cookieHeader || '').match(/(?:^|;\s*)fc_session=([^;]+)/)
  if (match && match[1]) {
    const digest = createHash('sha256').update(match[1]).digest('hex').slice(0, 32)
    return `write:session:${digest}`
  }
  const ip = (forwardedFor || '').split(',')[0].trim() || (realIp || '').trim() || 'unknown'
  return `write:ip:${ip}`
}
