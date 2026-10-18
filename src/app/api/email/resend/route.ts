import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { generateOtp } from '@/lib/auth'
import { errorJson, json } from '@/lib/serialize'
import { sendEmail, isEmailConfigured } from '@/lib/email'

// POST resend email verification
export async function POST() {
  try {
    const me = await getSessionUser()
    if (!me) return errorJson('Unauthorized', 401)
    const user = await db.user.findUnique({ where: { id: me.id } })
    if (!user) return errorJson('User not found', 404)
    if (user.emailVerified) return errorJson('Email already verified', 400)
    const code = generateOtp()
    await db.user.update({ where: { id: me.id }, data: { otpCode: code, otpExpiry: new Date(Date.now() + 10 * 60 * 1000) } })
    const sent = await sendEmail(
      user.email,
      'FriendConnect email verification',
      `Your verification code is ${code}. It expires in 10 minutes.`
    )
    const payload: { ok: boolean; message: string; code?: string } = {
      ok: sent.ok,
      message: sent.ok ? 'Verification code sent.' : sent.error || 'Email send failed',
    }
    if (process.env.NODE_ENV !== 'production' && !isEmailConfigured()) payload.code = code
    return json(payload, sent.ok ? 200 : 502)
  } catch (e: unknown) {
    const err = e as Error
    return errorJson(err?.message || 'Server error', 500)
  }
}
