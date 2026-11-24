import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { generateTwoFactorSecret, buildOtpauthUri } from '@/lib/totp'
import { json } from '@/lib/serialize'
import { handleRouteError, RouteError, conflict } from '@/lib/api-errors'

/**
 * POST /api/2fa/setup
 *
 * Begin enrolment: generate a secret, store it as *unconfirmed*, and return the
 * `otpauth://` URI.
 *
 * Finding #6: the previous version also returned a `qrDataUrl` pointing at
 * `api.qrserver.com?...data=<otpauth uri>`, which transmitted the TOTP secret to
 * a third-party service. That URL is gone; the client renders the QR itself from
 * `uri` (any local QR library), so the secret never leaves this server.
 *
 * Calling setup again before confirming replaces the pending secret, so a lost
 * QR code can be re-issued without leaving stale material behind.
 */
export async function POST() {
  try {
    const me = await getSessionUser()
    if (!me) throw new RouteError('UNAUTHORIZED')

    const user = await db.user.findUnique({ where: { id: me.id } })
    if (!user) throw new RouteError('NOT_FOUND', 'User not found.')
    if (user.twoFactorEnabled) throw conflict('Two-factor authentication is already enabled.')

    const secret = generateTwoFactorSecret()
    await db.user.update({
      where: { id: me.id },
      data: {
        // Unconfirmed until /api/2fa/verify checks a code against it.
        twoFactorSecret: secret,
        twoFactorConfirmedSecret: null,
        twoFactorAttempts: 0,
      },
    })

    return json({
      uri: buildOtpauthUri(user.email, secret),
      // The secret is returned here *because this is enrolment* and the client
      // must display it for manual entry. It is not returned by any other route.
      secret,
      // No remote QR service: render `uri` locally.
      qr: { type: 'otpauth-uri', value: buildOtpauthUri(user.email, secret) },
      digits: 6,
      period: 30,
    })
  } catch (error) {
    return handleRouteError(error, 'POST /api/2fa/setup')
  }
}
