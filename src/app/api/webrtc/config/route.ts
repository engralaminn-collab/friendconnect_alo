import { NextRequest } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { isTurnConfigured, STUN_SERVERS, TURN_SERVERS, turnCredentials } from '@/lib/ice'
import { json, errorJson } from '@/lib/serialize'

const LOOPBACK = /^(turns?:)(127\.0\.0\.1|localhost|0\.0\.0\.0|\[::1\])(?=[:?]|$)/i

/**
 * `.env.example` ships `TURN_SERVERS=turn:127.0.0.1:3478` (the bundled node-turn).
 * Handing a loopback TURN URL to a phone is useless — the phone would try to reach
 * its *own* 127.0.0.1. Substitute the public host the browser used to reach us.
 */
function publicTurnUrl(url: string, req: NextRequest): string {
  if (!LOOPBACK.test(url)) return url
  const fwd = req.headers.get('x-forwarded-host') || req.headers.get('host') || ''
  const host = fwd.split(',')[0].trim().replace(/:\d+$/, '')
  if (!host || /^(127\.0\.0\.1|localhost|\[::1\])$/i.test(host)) return url
  return url.replace(LOOPBACK, `$1${host}`)
}

export async function GET(req: NextRequest) {
  try {
    const me = await getSessionUser()
    if (!me) return errorJson('Unauthorized', 401)
    const turnConfigured = isTurnConfigured()
    const iceServers: { urls: string; username?: string; credential?: string }[] = STUN_SERVERS.map((urls) => ({ urls }))
    if (turnConfigured) {
      const { username, credential } = turnCredentials()
      for (const urls of TURN_SERVERS) {
        iceServers.push({ urls: publicTurnUrl(urls, req), username, credential })
      }
    }
    return json({
      iceServers,
      stunServers: STUN_SERVERS,
      turnConfigured,
      iceTransportPolicy: 'all',
    })
  } catch (e: unknown) {
    const err = e as Error
    return errorJson(err?.message || 'Server error', 500)
  }
}
