import { createHmac } from 'crypto'

function splitEnv(value: string | undefined, fallback = ''): string[] {
  return (value || fallback)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export const STUN_SERVERS = splitEnv(
  process.env.STUN_SERVERS || process.env.STUN_SERVER,
  'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302,stun:stun.cloudflare.com:3478'
)
export const TURN_SERVERS = splitEnv(process.env.TURN_SERVERS || process.env.TURN_SERVER)
export const TURN_USERNAME = process.env.TURN_USERNAME || ''
export const TURN_PASSWORD = process.env.TURN_PASSWORD || ''
export const TURN_SECRET = process.env.TURN_SECRET || ''
export const TURN_REALM = process.env.TURN_REALM || 'friendconnect'

export function iceServers(): { urls: string; username?: string; credential?: string }[] {
  const servers: { urls: string; username?: string; credential?: string }[] = STUN_SERVERS.map((urls) => ({ urls }))
  if (TURN_SERVERS.length > 0 && (TURN_USERNAME || TURN_SECRET)) {
    const { username, credential } = turnCredentials()
    for (const urls of TURN_SERVERS) {
      servers.push({ urls, username, credential })
    }
  }
  return servers
}

export function turnCredentials(): { username: string; credential: string } {
  // Static long-term credentials (node-turn / coturn --user). Prefer these when set
  // so HMAC REST secrets are not mixed into a server that only knows a password.
  if (TURN_USERNAME && TURN_PASSWORD) {
    return { username: TURN_USERNAME, credential: TURN_PASSWORD }
  }
  if (TURN_SECRET) {
    const expires = Math.floor(Date.now() / 1000) + 3600
    const username = `${expires}:friendconnect`
    const credential = createHmac('sha1', TURN_SECRET).update(username).digest('base64')
    return { username, credential }
  }
  return { username: TURN_USERNAME, credential: TURN_PASSWORD }
}

export function isTurnConfigured(): boolean {
  return TURN_SERVERS.length > 0 && !!(TURN_USERNAME || TURN_SECRET)
}

export function clientIceConfig() {
  return {
    stunServers: STUN_SERVERS,
    turnConfigured: isTurnConfigured(),
  }
}
