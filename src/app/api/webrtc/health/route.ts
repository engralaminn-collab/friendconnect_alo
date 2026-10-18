import { json } from '@/lib/serialize'
import { isTurnConfigured, STUN_SERVERS, TURN_REALM } from '@/lib/ice'
import { isRedisAvailable } from '@/lib/cache'
import { isEmailConfigured } from '@/lib/email'

// GET /api/webrtc/health — public WebRTC subsystem health (no secrets)
export async function GET() {
  const checks: Record<string, string> = {}
  try {
    const port = process.env.SOCKET_PORT || '3003'
    const ac = new AbortController()
    const t = setTimeout(() => ac.abort(), 2000)
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: ac.signal }).catch(() => null)
    clearTimeout(t)
    checks.signaling = res && res.ok ? 'ok' : 'error'
  } catch {
    checks.signaling = 'error'
  }
  // STUN
  checks.stun = STUN_SERVERS.length > 0 ? 'ok' : 'unconfigured'
  // TURN
  checks.turn = isTurnConfigured() ? 'ok' : 'unconfigured'
  // Redis (for multi-process realtime scaling)
  checks.redis = isRedisAvailable() ? 'ok' : 'unconfigured'
  // HTTPS (detected via x-forwarded-proto)
  // Email (for verification — not strictly call-related but part of health)
  checks.email = isEmailConfigured() ? 'ok' : 'unconfigured'
  // TURN realm
  checks.turnRealm = TURN_REALM
  const allOk = checks.signaling === 'ok' && checks.stun === 'ok'
  const degraded = checks.turn !== 'ok' // TURN not configured = degraded (calls may fail on strict NATs)
  return json({
    status: degraded ? 'degraded' : (allOk ? 'healthy' : 'unhealthy'),
    checks,
    warning: degraded ? 'TURN not configured — calls across strict NATs/different ISPs may fail. Set TURN_SERVERS + TURN_USERNAME/PASSWORD or TURN_SECRET.' : null,
    timestamp: new Date().toISOString(),
  }, degraded ? 200 : (allOk ? 200 : 503))
}
