import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { generateOtp, clientIp } from '@/lib/auth'
import { errorJson, json } from '@/lib/serialize'
import { rateLimit } from '@/lib/cache'
import { sendEmail, isEmailConfigured } from '@/lib/email'
import { audit } from '@/lib/audit'

export async function POST(req: NextRequest) {
  try {
    const ip = clientIp(req) || 'unknown'
    const rl = await rateLimit(`forgot:${ip}`, 5, 300)
    if (!rl.allowed) return errorJson('Too many reset requests', 429)

    const body = await req.json()
    const identifier = String(body.email || body.username || '').trim().toLowerCase()
    if (!identifier) return errorJson('Email or username required', 400)
    const user = await db.user.findFirst({
      where: { OR: [{ email: identifier }, { username: identifier }] },
    })
    // Do not leak account existence
    if (!user) {
      return json({ ok: true, message: 'If an account exists, a reset code was sent.' })
    }
    const otp = generateOtp()
    const expiry = new Date(Date.now() + 1000 * 60 * 10)
    await db.user.update({
      where: { id: user.id },
      data: { otpCode: otp, otpExpiry: expiry },
    })
    await sendEmail(user.email, 'FriendConnect password reset', `Your reset code is ${otp}. It expires in 10 minutes.`)
    await audit({ userId: user.id, action: 'password_reset_requested', ip })

    const payload: { ok: boolean; message: string; otp?: string } = {
      ok: true,
      message: 'If an account exists, a reset code was sent.',
    }
    if (process.env.NODE_ENV !== 'production' && !isEmailConfigured()) {
      payload.otp = otp
    }
    return json(payload)
  } catch (e: unknown) {
    const err = e as Error
    return errorJson(err?.message || 'Server error', 500)
  }
}
