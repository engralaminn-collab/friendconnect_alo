import { db } from '@/lib/db'
import { clearSessionCookie, getCurrentSessionToken, getLegacyCookieSessionToken, getSessionUser } from '@/lib/session'
import { errorJson, json } from '@/lib/serialize'
import { audit } from '@/lib/audit'

export async function POST() {
  try {
    const user = await getSessionUser()
    const tokens = new Set([await getCurrentSessionToken(), await getLegacyCookieSessionToken()].filter((t): t is string => !!t))
    if (tokens.size) {
      // Do not report successful logout if the revocation authority could not
      // delete the session row; otherwise existing realtime tokens stay valid.
      await db.session.deleteMany({ where: { token: { in: Array.from(tokens) } } })
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
