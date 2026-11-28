import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { audit } from '@/lib/audit'
import { json } from '@/lib/serialize'
import { rateLimit } from '@/lib/cache'
import { handleRouteError, RouteError, invalid, conflict } from '@/lib/api-errors'
import {
  BACKUP_CODE_COUNT,
  generateBackupCodes,
  serializeBackupCodes,
  verifyTotpOnce,
} from '@/lib/two-factor'

/**
 * POST /api/2fa/verify
 *
 * Confirm the pending secret with a TOTP code and enable 2FA.
 *
 * Finding #6: enabling is the only moment the secret becomes trusted, so the
 * confirmed secret is written here (not at setup), and the ten backup codes are
 * returned exactly once and stored as digests. They are now redeemable: the
 * login challenge accepts an unused backup code and removes it.
 */
export async function POST(req: NextRequest) {
  try {
    const me = await getSessionUser()
    if (!me) throw new RouteError('UNAUTHORIZED')

    const limit = await rateLimit(`2fa-verify:${me.id}`, 10, 300)
    if (!limit.allowed) throw new RouteError('RATE_LIMITED')

    const user = await db.user.findUnique({ where: { id: me.id } })
    if (!user) throw new RouteError('NOT_FOUND', 'User not found.')
    if (user.twoFactorEnabled) throw conflict('Two-factor authentication is already enabled.')
    if (!user.twoFactorSecret) throw invalid('Start setup first.')

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') throw invalid('Invalid request body')
    const code = String((body as Record<string, unknown>).code ?? '').trim()
    if (!/^\d{6}$/.test(code)) throw invalid('Enter the 6-digit code from your app.')

    if (!(await verifyTotpOnce(me.id, code, user.twoFactorSecret))) {
      throw invalid('That code is not correct. Check your authenticator and try again.')
    }

    const codes = generateBackupCodes(BACKUP_CODE_COUNT)
    await db.user.update({
      where: { id: me.id },
      data: {
        twoFactorEnabled: true,
        twoFactorConfirmedSecret: user.twoFactorSecret,
        // The pending slot is not needed once confirmed.
        twoFactorSecret: null,
        twoFactorBackup: serializeBackupCodes(codes),
        twoFactorBackupUsed: 0,
        twoFactorAttempts: 0,
      },
    })

    await audit({ userId: me.id, action: '2fa_enable' })

    // Shown once. Never retrievable again.
    return json({
      ok: true,
      enabled: true,
      backupCodes: codes,
      warning: 'Store these codes somewhere safe. Each can be used once and they will not be shown again.',
    })
  } catch (error) {
    return handleRouteError(error, 'POST /api/2fa/verify')
  }
}
