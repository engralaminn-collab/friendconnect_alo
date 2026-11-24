import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { verifyPassword } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { json } from '@/lib/serialize'
import { rateLimit } from '@/lib/cache'
import { handleRouteError, RouteError, invalid } from '@/lib/api-errors'
import { verifySecondFactor } from '@/lib/two-factor'

/**
 * POST /api/2fa/disable
 *
 * Turn 2FA off only after proving BOTH factors: the account password and a
 * current TOTP code or an unused backup code.
 *
 * Finding #6: the previous version checked the password only, documented as
 * "simplified". That turns a stolen session into a permanent 2FA bypass —
 * exactly the attacker 2FA is meant to stop.
 */
export async function POST(req: NextRequest) {
  try {
    const me = await getSessionUser()
    if (!me) throw new RouteError('UNAUTHORIZED')

    const limit = await rateLimit(`2fa-disable:${me.id}`, 10, 300)
    if (!limit.allowed) throw new RouteError('RATE_LIMITED')

    const user = await db.user.findUnique({ where: { id: me.id } })
    if (!user) throw new RouteError('NOT_FOUND', 'User not found.')
    if (!user.twoFactorEnabled) {
      return json({ ok: true, enabled: false, message: 'Two-factor authentication is not enabled.' })
    }

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') throw invalid('Invalid request body')
    const fields = body as Record<string, unknown>
    const password = String(fields.password ?? '')
    // Accept the code under either name; `code` is preferred.
    const code = String(fields.code ?? fields.totp ?? fields.backupCode ?? '').trim()

    if (!password) throw invalid('Enter your password to disable two-factor authentication.')
    if (!code) throw invalid('Enter a current authenticator code or a backup code.')

    if (!(await verifyPassword(password, user.passwordHash))) {
      await audit({ userId: me.id, action: '2fa_disable_failed', meta: { reason: 'bad password' } })
      throw new RouteError('FORBIDDEN', 'That password is not correct.')
    }

    const second = await verifySecondFactor(user, code)
    if (!second.ok) {
      await audit({ userId: me.id, action: '2fa_disable_failed', meta: { reason: 'bad second factor' } })
      throw new RouteError('FORBIDDEN', 'That code is not correct.')
    }

    await db.user.update({
      where: { id: me.id },
      data: {
        twoFactorEnabled: false,
        twoFactorSecret: null,
        twoFactorConfirmedSecret: null,
        twoFactorBackup: null,
        twoFactorBackupUsed: 0,
        twoFactorAttempts: 0,
      },
    })
    await audit({ userId: me.id, action: '2fa_disable', meta: { secondFactor: second.method } })
    return json({ ok: true, enabled: false })
  } catch (error) {
    return handleRouteError(error, 'POST /api/2fa/disable')
  }
}
