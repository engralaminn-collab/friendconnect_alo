import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { json } from '@/lib/serialize'
import { sendEmail, isEmailConfigured } from '@/lib/email'
import { handleRouteError, invalid, RouteError, conflict } from '@/lib/api-errors'
import { generateOtp, hashCode, OTP_TTL_MS, RESEND_COOLDOWN_SECONDS } from '@/lib/one-time-code'

/**
 * POST /api/email/resend
 *
 * Re-send the e-mail verification code. Same hardening as the password-reset
 * flow: CSPRNG code, scrypt hash at rest, per-account resend throttle, and the
 * code never appears in a response body.
 */
export async function POST() {
  try {
    const me = await getSessionUser()
    if (!me) throw new RouteError('UNAUTHORIZED')

    const user = await db.user.findUnique({ where: { id: me.id } })
    if (!user) throw new RouteError('NOT_FOUND', 'User not found.')
    if (user.emailVerified) throw conflict('Your e-mail is already verified.')

    const sentAt = user.otpSentAt instanceof Date ? user.otpSentAt.getTime() : 0
    if (sentAt && Date.now() - sentAt < RESEND_COOLDOWN_SECONDS * 1000) {
      const wait = Math.ceil((RESEND_COOLDOWN_SECONDS * 1000 - (Date.now() - sentAt)) / 1000)
      return json(
        { error: `Please wait ${wait}s before requesting another code.`, code: 'RATE_LIMITED', retryAfter: wait },
        429,
      )
    }

    const code = generateOtp()
    const now = new Date()
    await db.user.update({
      where: { id: me.id },
      data: {
        otpCode: await hashCode(code),
        otpExpiry: new Date(now.getTime() + OTP_TTL_MS),
        otpAttempts: 0,
        otpSentAt: now,
      },
    })

    const sent = await sendEmail(
      user.email,
      'FriendConnect email verification',
      `Your verification code is ${code}. It expires in 10 minutes and can be used once.`,
    )

    if (!isEmailConfigured()) {
      // Development convenience only — the code is logged, never returned.
      console.log(`[auth] e-mail is not configured; verification code for ${user.id}: ${code}`)
    }

    return json(
      {
        ok: sent.ok,
        message: sent.ok ? 'Verification code sent.' : 'Could not send e-mail right now.',
      },
      sent.ok ? 200 : 502,
    )
  } catch (error) {
    return handleRouteError(error, 'POST /api/email/resend')
  }
}
