import { db } from '@/lib/db'
import { isRedisAvailable, getCache } from '@/lib/cache'
import { isEmailConfigured } from '@/lib/email'
import { isPushConfigured } from '@/lib/push'
import { json } from '@/lib/serialize'
import { realtimeUrl } from '@/lib/paths'

export async function GET() {
  const checks: Record<string, string> = {}
  let ok = true
  let degraded = false

  try {
    await db.user.count()
    checks.database = 'ok'
  } catch {
    checks.database = 'error'
    ok = false
  }

  try {
    const url = realtimeUrl()
    const ac = new AbortController()
    const t = setTimeout(() => ac.abort(), 2000)
    const res = await fetch(`${url}/health`, { signal: ac.signal }).catch(() => null)
    clearTimeout(t)
    checks.realtime = res && res.ok ? 'ok' : 'error'
    if (checks.realtime !== 'ok') {
      degraded = true
    }
  } catch {
    checks.realtime = 'error'
    degraded = true
  }

  if (isRedisAvailable()) {
    try {
      const cache = getCache()
      await cache.set('health:ping', 'pong', 5)
      const val = await cache.get('health:ping')
      checks.redis = val === 'pong' ? 'ok' : 'error'
      if (checks.redis !== 'ok') degraded = true
    } catch {
      checks.redis = 'error'
      degraded = true
    }
  } else {
    checks.redis = 'unconfigured'
  }

  checks.email = isEmailConfigured() ? 'ok' : 'unconfigured'
  checks.push = isPushConfigured() ? 'ok' : 'unconfigured'
  checks.uptime = `${process.uptime().toFixed(1)}s`

  const status = !ok ? 'unhealthy' : degraded ? 'degraded' : 'healthy'
  return json({ status, checks, timestamp: new Date().toISOString() }, ok ? 200 : 503)
}
