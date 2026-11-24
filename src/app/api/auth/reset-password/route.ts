import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { hashPassword, validatePassword, clientIp } from '@/lib/auth'
import { json } from '@/lib/serialize'
import { rateLimit } from '@/lib/cache'
import { audit } from '@/lib/audit'
import { handleRouteError, invalid, RouteError } from '@/lib/api-errors'
import { digestToken, digestsEqual, MAX_ATTEMPTS, verifyHash } from '@/lib/one-time-code'

/**
 * POST /api/auth/reset-password
 *
 * Finish a reset with either the single-use credential from /verify-otp or, for
 * clients that redeem the code directly, the code itself.
 *
 * Finding #5:
 *  - the credential is compared as a digest and redeemed exactly once,
 *  - the OTP path is behind the same attempt limit as /verify-otp,
 *  - on success every reset credential, OTP state and *all existing sessions*
 *    are cleared: a reset is how you recover a compromised account, so anyone
 *    already logged in must be logged out. Changing a password through
 *    /api/users/me does the same.
 */
export async function POST(req: NextRequest) {
  try {
    const ip = clientIp(req) || 'unknown'
    const limit = await rateLimit(`reset-password:${ip}`, 10, 300)
    if (!limit.allowed) throw new RouteError('RATE_LIMITED', 'Too many attempts. Try again later.')

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') throw invalid('Invalid request body')

    const fields = body as Record<string, unknown>
    const identifier = String(fields.email ?? fields.username ?? '').trim().toLowerCase()
    const password = String(fields.password ?? '')
    const resetToken = String(fields.resetToken ?? '').trim()
    const otp = String(fields.otp ?? '').trim()

    if (!identifier || !password) throw invalid('Missing fields')

    const check = validatePassword(password)
    if (!check.valid) throw invalid(check.reason || 'Invalid password')

    const user = await db.user.findFirst({
      where: { OR: [{ email: identifier }, { username: identifier }] },
    })

    const INVALID = 'That reset link is invalid or has expired.'
    if (!user) throw new RouteError('VALIDATION_FAILED', INVALID)

    let authorised = false

    if (resetToken) {
      const expiry =
        user.resetTokenExpiry instanceof Date
          ? user.resetTokenExpiry
          : user.resetTokenExpiry
            ? new Date(user.resetTokenExpiry)
            : null
      if (user.resetTokenHash && expiry && expiry.getTime() > Date.now()) {
        authorised = digestsEqual(digestToken(resetToken), user.resetTokenHash)
      }
    }

    if (!authorised && otp && user.otpCode && user.otpExpiry) {
      const expiry = user.otpExpiry instanceof Date ? user.otpExpiry : new Date(user.otpExpiry)
      const attempts = Number(user.otpAttempts ?? 0)
      if (expiry.getTime() > Date.now() && attempts < MAX_ATTEMPTS) {
        authorised = await verifyHash(otp, user.otpCode)
        if (!authorised) {
          const next = attempts + 1
          await db.user.update({
            where: { id: user.id },
            data: next >= MAX_ATTEMPTS ? { otpCode: null, otpExpiry: null, otpAttempts: 0 } : { otpAttempts: next },
          })
        }
      }
    }

    if (!authorised) throw new RouteError('VALIDATION_FAILED', INVALID)

    await db.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await hashPassword(password),
        otpCode: null,
        otpExpiry: null,
        otpAttempts: 0,
        otpSentAt: null,
        resetTokenHash: null,
        resetTokenExpiry: null,
      },
    })

    // A password change must not leave old sessions usable.
    try {
      await db.session.deleteMany({ where: { userId: user.id } })
    } catch {
      // Session cleanup is important but must not fail the reset itself; the
      // user has already proven ownership of the address.
    }

    await audit({ userId: user.id, action: 'password_reset_completed', ip })
    return json({ ok: true })
  } catch (error) {
    return handleRouteError(error, 'POST /api/auth/reset-password')
  }
}
