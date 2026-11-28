import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { json, errorJson } from '@/lib/serialize'
import { getSessionUser } from '@/lib/session'
import { timingSafeEqual } from 'node:crypto'

/**
 * Compare two secrets without leaking their length or content through timing.
 *
 * The previous check was `provided.length === expected.length && provided ===
 * expected`, which short-circuits on the first differing byte, so a caller could
 * recover a token byte by byte from response timing. Every other secret
 * comparison in this codebase (`socket-server.js`, `one-time-code.ts`,
 * `jara-sms-signature.ts`) already used a constant-time compare; this one was the
 * outlier.
 */
function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  if (a.length !== b.length) {
    // Still compare something of equal length so the mismatch is not free.
    timingSafeEqual(a, a)
    return false
  }
  return timingSafeEqual(a, b)
}

// Prometheus-style metrics endpoint.
//
// Scrapers cannot hold a session cookie, so access is granted one of two ways:
//   1. `Authorization: Bearer $METRICS_TOKEN` (preferred for Prometheus), or
//   2. an admin session (for humans poking at it in a browser).
// If METRICS_TOKEN is unset, only admin sessions are accepted — the endpoint is
// never anonymously readable.
export async function GET(req: NextRequest) {
  const expected = process.env.METRICS_TOKEN
  const auth = req.headers.get('authorization') || ''
  let allowed = false
  if (expected) {
    const provided = auth.startsWith('Bearer ') ? auth.slice(7) : ''
    allowed = secretsMatch(provided, expected)
  }
  if (!allowed) {
    const me = await getSessionUser().catch(() => null)
    allowed = !!me && (me.role === 'admin' || me.role === 'superadmin')
  }
  if (!allowed) return errorJson('Unauthorized', 401)

  const [users, messages, groups, calls, stories, sessions, files] = await Promise.all([
    db.user.count(),
    db.message.count(),
    db.group.count(),
    db.call.count(),
    db.story.count(),
    db.session.count({ where: { expiresAt: { gt: new Date() } } }),
    db.file.count(),
  ])
  const lines = [
    '# HELP friendconnect_users_total Total registered users',
    '# TYPE friendconnect_users_total gauge',
    `friendconnect_users_total ${users}`,
    '# HELP friendconnect_messages_total Total messages sent',
    '# TYPE friendconnect_messages_total gauge',
    `friendconnect_messages_total ${messages}`,
    '# HELP friendconnect_groups_total Total groups',
    '# TYPE friendconnect_groups_total gauge',
    `friendconnect_groups_total ${groups}`,
    '# HELP friendconnect_calls_total Total calls',
    '# TYPE friendconnect_calls_total gauge',
    `friendconnect_calls_total ${calls}`,
    '# HELP friendconnect_stories_total Total stories',
    '# TYPE friendconnect_stories_total gauge',
    `friendconnect_stories_total ${stories}`,
    '# HELP friendconnect_active_sessions Active sessions',
    '# TYPE friendconnect_active_sessions gauge',
    `friendconnect_active_sessions ${sessions}`,
    '# HELP friendconnect_files_total Total uploaded files',
    '# TYPE friendconnect_files_total gauge',
    `friendconnect_files_total ${files}`,
  ]
  return new Response(lines.join('\n') + '\n', { headers: { 'content-type': 'text/plain; version=0.0.4' } })
}
