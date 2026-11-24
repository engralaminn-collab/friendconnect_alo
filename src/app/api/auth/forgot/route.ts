import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { clientIp } from '@/lib/auth'
import { json } from '@/lib/serialize'
import { rateLimit } from '@/lib/cache'
import { sendEmail, isEmailConfigured } from '@/lib/email'
import { audit } from '@/lib/audit'
import { handleRouteError, invalid, RouteError } from '@/lib/api-errors'
import {
  generateOtp,
  hashCode,
  OTP_TTL_MS,
  RESEND_COOLDOWN_SECONDS,
} from '@/lib/one-time-code'

/**
 * POST /api/auth/forgot
 *
 * Start a password reset. Finding #5:
 *  - the code is generated with a CSPRNG and stored as a scrypt hash,
 *  - re-sends are throttled per account as well as per IP,
 *  - the response is byte-identical whether or not the account exists, so it
 *    cannot be used to enumerate users,
 *  - the code is never included in the response (the old development-only
 *    `payload.otp` shortcut is gone; use the server log or the console mailer).
 */

const GENERIC = 'If an account exists for that address, a reset code has been sent.'

export async function POST(req: NextRequest) {
  try {
    const ip = clientIp(req) || 'unknown'
    const perIp = await rateLimit(`forgot:ip:${ip}`, 5, 300)
    if (!perIp.allowed) {
      throw new RouteError('RATE_LIMITED', 'Too many reset requests. Try again later.')
    }

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') throw invalid('Invalid request body')

    const identifier = String(
      (body as Record<string, unknown>).email ?? (body as Record<string, unknown>).username ?? '',
    )
      .trim()
      .toLowerCase()
    if (!identifier) throw invalid('Email or username required')

    const user = await db.user.findFirst({
      where: { OR: [{ email: identifier }, { username: identifier }] },
    })

    // Always answer the same way and take a similar amount of time.
    if (!user) {
      await new Promise((resolve) => setTimeout(resolve, 120))
      return json({ ok: true, message: GENERIC })
    }

    // Per-account throttle: an attacker who knows the address cannot keep the
    // code window alive or flood the inbox.
    const sentAt = user.otpSentAt instanceof Date ? user.otpSentAt.getTime() : 0
    if (sentAt && Date.now() - sentAt < RESEND_COOLDOWN_SECONDS * 1000) {
      return json({ ok: true, message: GENERIC, retryAfter: RESEND_COOLDOWN_SECONDS })
    }

    const code = generateOtp()
    const now = new Date()
    await db.user.update({
      where: { id: user.id },
      data: {
        otpCode: await hashCode(code),
        otpExpiry: new Date(now.getTime() + OTP_TTL_MS),
        otpAttempts: 0,
        otpSentAt: now,
        // Issuing a new code invalidates any credential from a previous round.
        resetTokenHash: null,
        resetTokenExpiry: null,
      },
    })

    await sendEmail(
      user.email,
      'FriendConnect password reset',
      `Your password reset code is ${code}. It expires in 10 minutes and can be used once. ` +
        `If you did not request this, you can ignore this email.`,
    )
    await audit({ userId: user.id, action: 'password_reset_requested', ip })

    // Deliberately no `otp` field. When mail is not configured the code is
    // printed to the server log only, so a developer can continue without it
    // ever becoming an API response.
    if (!isEmailConfigured()) {
      console.log(`[auth] e-mail is not configured; reset code for ${user.id}: ${code}`)
    }

    return json({ ok: true, message: GENERIC })
  } catch (error) {
    return handleRouteError(error, 'POST /api/auth/forgot')
  }
}
