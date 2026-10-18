import { getSessionUser } from '@/lib/session'
import { isTurnConfigured, STUN_SERVERS, TURN_SERVERS, turnCredentials } from '@/lib/ice'
import { json, errorJson } from '@/lib/serialize'

export async function GET() {
  try {
    const me = await getSessionUser()
    if (!me) return errorJson('Unauthorized', 401)
    const turnConfigured = isTurnConfigured()
    const iceServers: { urls: string; username?: string; credential?: string }[] = STUN_SERVERS.map((urls) => ({ urls }))
    if (turnConfigured) {
      const { username, credential } = turnCredentials()
      for (const urls of TURN_SERVERS) {
        iceServers.push({ urls, username, credential })
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
