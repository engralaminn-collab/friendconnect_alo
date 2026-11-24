import { realtimeUrl } from '@/lib/paths'

function resolveInternalSecret(): string {
  const s = process.env.SOCKET_INTERNAL_SECRET || process.env.NEXTAUTH_SECRET
  if (s && s.length > 0) return s
  if (process.env.NODE_ENV !== 'production') return 'friendconnect-dev-secret-change-in-production'
  return ''
}

export async function emitRealtimeToUsers(
  userIds: string[],
  event: 'message:new' | 'message:updated' | 'message:deleted' | 'message:reaction' | 'notification',
  payload: unknown,
): Promise<void> {
  const secret = resolveInternalSecret()
  if (!secret || !userIds.length) return
  const uniq = Array.from(new Set(userIds.filter((u) => typeof u === 'string' && u.length > 0)))
  if (!uniq.length) return

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 1500)
    await fetch(`${realtimeUrl()}/internal/emit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-secret': secret,
      },
      body: JSON.stringify({ userIds: uniq, event, payload }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer))
  } catch {
    // Best-effort push to realtime server; REST response already persisted in DB.
  }
}
