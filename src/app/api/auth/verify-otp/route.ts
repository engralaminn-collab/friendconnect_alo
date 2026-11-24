import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { json } from '@/lib/serialize'
import { rateLimit } from '@/lib/cache'
import { handleRouteError, invalid, RouteError } from '@/lib/api-errors'
import {
  MAX_ATTEMPTS,
  RESET_TOKEN_TTL_MS,
  digestsEqual,
  generateResetToken,
  verifyHash,
} from '@/lib/one-time-code'
import { clientIp } from '@/lib/auth'

/**
 * POST /api/auth/verify-otp
 *
 * Exchange a correct one-time code for a single-use reset credential.
 *
 * Finding #5:
 *  - the code is compared against a hash in constant time,
 *  - every wrong guess is counted; at MAX_ATTEMPTS the code is destroyed so the
 *    6-digit space cannot be brute-forced,
 *  - the old response body `resetToken: otp + ':' + userId` leaked the code and
 *    the user id and never expired. The credential is now 32 random bytes,
 *    stored as a digest, valid for 15 minutes and redeemable once.
 *  - an unknown account returns the same error as a wrong code, so this
 *    endpoint cannot be used to enumerate users.
 */

const INVALID = 'That code is invalid or has expired.'

export async function POST(req: NextRequest) {
  try {
    const ip = clientIp(req) || 'unknown'
    const limit = await rateLimit(`verify-otp:${ip}`, 10, 300)
    if (!limit.allowed) {
      throw new RouteError('RATE_LIMITED', 'Too many attempts. Try again later.')
    }

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') throw invalid('Invalid request body')

    const fields = body as Record<string, unknown>
    const identifier = String(fields.email ?? fields.username ?? '').trim().toLowerCase()
    const code = String(fields.otp ?? '').trim()
    if (!identifier || !code) throw invalid('Missing fields')

    const user = await db.user.findFirst({
      where: { OR: [{ email: identifier }, { username: identifier }] },
    })

    // Same response for "no such account" and "wrong code".
    if (!user || !user.otpCode || !user.otpExpiry) {
      throw new RouteError('VALIDATION_FAILED', INVALID)
    }

    const expiry = user.otpExpiry instanceof Date ? user.otpExpiry : new Date(user.otpExpiry)
    if (!(expiry.getTime() > Date.now())) {
      await db.user.update({
        where: { id: user.id },
        data: { otpCode: null, otpExpiry: null, otpAttempts: 0 },
      })
      throw new RouteError('VALIDATION_FAILED', INVALID)
    }

    const attempts = Number(user.otpAttempts ?? 0)
    if (attempts >= MAX_ATTEMPTS) {
      // Already burned; clear it so it cannot be resumed.
      await db.user.update({
        where: { id: user.id },
        data: { otpCode: null, otpExpiry: null, otpAttempts: 0 },
      })
      throw new RouteError('VALIDATION_FAILED', INVALID)
    }

    const matches = await verifyHash(code, user.otpCode)
    if (!matches) {
      const nextAttempts = attempts + 1
      await db.user.update({
        where: { id: user.id },
        data:
          nextAttempts >= MAX_ATTEMPTS
            ? { otpCode: null, otpExpiry: null, otpAttempts: 0 }
            : { otpAttempts: nextAttempts },
      })
      throw new RouteError(
        'VALIDATION_FAILED',
        nextAttempts >= MAX_ATTEMPTS
          ? 'Too many incorrect attempts. Request a new code.'
          : INVALID,
      )
    }

    // Success: burn the code and issue a fresh single-use credential.
    const { token, digest } = generateResetToken()
    await db.user.update({
      where: { id: user.id },
      data: {
        otpCode: null,
        otpExpiry: null,
        otpAttempts: 0,
        otpSentAt: null,
        resetTokenHash: digest,
        resetTokenExpiry: new Date(Date.now() + RESET_TOKEN_TTL_MS),
      },
    })

    return json({
      ok: true,
      resetToken: token,
      expiresIn: Math.floor(RESET_TOKEN_TTL_MS / 1000),
    })
  } catch (error) {
    return handleRouteError(error, 'POST /api/auth/verify-otp')
  }
}

/** Exposed for tests: constant-time digest comparison helper. */
export const __digestsEqual = digestsEqual
