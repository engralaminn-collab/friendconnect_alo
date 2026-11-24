import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { audit } from '@/lib/audit'
import { json } from '@/lib/serialize'
import { rateLimit } from '@/lib/cache'
import { handleRouteError, invalid, RouteError } from '@/lib/api-errors'
import { MAX_ATTEMPTS, verifyHash } from '@/lib/one-time-code'

/**
 * POST /api/email/verify
 *
 * Confirm the signed-in user's e-mail with the code from /api/email/resend.
 * Hashed comparison, constant time, attempt-limited and single-use — the same
 * rules as the password-reset code, which previously applied to neither.
 */
export async function POST(req: NextRequest) {
  try {
    const me = await getSessionUser()
    if (!me) throw new RouteError('UNAUTHORIZED')

    const limit = await rateLimit(`email-verify:${me.id}`, 10, 300)
    if (!limit.allowed) throw new RouteError('RATE_LIMITED')

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') throw invalid('Invalid request body')
    // Accept both `code` and the older `otp` field.
    const fields = body as Record<string, unknown>
    const code = String(fields.code ?? fields.otp ?? '').trim()
    if (!code) throw invalid('Code required')

    const user = await db.user.findUnique({ where: { id: me.id } })
    if (!user) throw new RouteError('NOT_FOUND', 'User not found.')
    if (user.emailVerified) throw new RouteError('CONFLICT', 'Your e-mail is already verified.')

    if (!user.otpCode || !user.otpExpiry) throw invalid('No verification code was requested.')
    const expiry = user.otpExpiry instanceof Date ? user.otpExpiry : new Date(user.otpExpiry)
    if (!(expiry.getTime() > Date.now())) {
      await db.user.update({ where: { id: me.id }, data: { otpCode: null, otpExpiry: null, otpAttempts: 0 } })
      throw invalid('That code has expired. Request a new one.')
    }

    const attempts = Number(user.otpAttempts ?? 0)
    if (attempts >= MAX_ATTEMPTS) {
      await db.user.update({ where: { id: me.id }, data: { otpCode: null, otpExpiry: null, otpAttempts: 0 } })
      throw invalid('Too many incorrect attempts. Request a new code.')
    }

    if (!(await verifyHash(code, user.otpCode))) {
      const next = attempts + 1
      await db.user.update({
        where: { id: me.id },
        data:
          next >= MAX_ATTEMPTS
            ? { otpCode: null, otpExpiry: null, otpAttempts: 0 }
            : { otpAttempts: next },
      })
      throw invalid(
        next >= MAX_ATTEMPTS
          ? 'Too many incorrect attempts. Request a new code.'
          : 'That code is not correct.',
      )
    }

    await db.user.update({
      where: { id: me.id },
      data: { emailVerified: true, otpCode: null, otpExpiry: null, otpAttempts: 0, otpSentAt: null },
    })
    await audit({ userId: me.id, action: 'email_verify' })
    return json({ ok: true })
  } catch (error) {
    return handleRouteError(error, 'POST /api/email/verify')
  }
}
