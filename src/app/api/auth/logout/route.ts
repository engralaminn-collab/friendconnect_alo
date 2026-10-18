import { db } from '@/lib/db'
import { clearSessionCookie, getCurrentSessionToken, getSessionUser } from '@/lib/session'
import { errorJson, json } from '@/lib/serialize'
import { audit } from '@/lib/audit'

export async function POST() {
  try {
    const user = await getSessionUser()
    const token = await getCurrentSessionToken()
    if (token) {
      await db.session.deleteMany({ where: { token } }).catch(() => {})
    }
    if (user) {
      await audit({ userId: user.id, action: 'logout' })
    }
    await clearSessionCookie()
    return json({ ok: true })
  } catch (e: unknown) {
    const err = e as Error
    return errorJson(err?.message || 'Server error', 500)
  }
}
