import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { hashPassword, validatePassword, sanitizeUsername, isEmail, clientIp } from '@/lib/auth'
import { createSession, setSessionCookie } from '@/lib/session'
import { ensureProfile, errorJson, json } from '@/lib/serialize'
import { rateLimit } from '@/lib/cache'
import { audit } from '@/lib/audit'
import { sendEmail, isEmailConfigured } from '@/lib/email'
import { generateOtp } from '@/lib/auth'

export async function POST(req: NextRequest) {
  try {
    const ip = clientIp(req) || 'unknown'
    const rl = await rateLimit(`register:${ip}`, 5, 3600)
    if (!rl.allowed) return errorJson('Too many registrations from this network', 429)

    const body = await req.json()
    const { name, username, email, password } = body as Record<string, string>

    if (!password) return errorJson('Password is required', 400)
    const pwErr = validatePassword(password)
    if (pwErr) return errorJson(pwErr, 400)

    const finalUsername = sanitizeUsername(String(username || ''))
    const finalEmail = String(email || '').trim().toLowerCase()
    const finalName = String(name || '').trim()

    if (!finalName || finalName.length < 2) return errorJson('Name is required', 400)
    if (!finalUsername || finalUsername.length < 3) return errorJson('Username must be at least 3 characters', 400)
    if (!isEmail(finalEmail)) return errorJson('A valid email is required', 400)

    const existing = await db.user.findFirst({
      where: { OR: [{ email: finalEmail }, { username: finalUsername }] },
    })
    if (existing) return errorJson('That username or email is already registered. Sign in instead.', 409)

    const emailVerified = !isEmailConfigured()
    const otp = emailVerified ? null : generateOtp()

    const user = await db.user.create({
      data: {
        name: finalName,
        username: finalUsername,
        email: finalEmail,
        passwordHash: hashPassword(password),
        role: 'user',
        emailVerified,
        otpCode: otp,
        otpExpiry: otp ? new Date(Date.now() + 10 * 60 * 1000) : null,
      },
    })
    await ensureProfile(user.id)

    if (otp) {
      await sendEmail(
        finalEmail,
        'Verify your FriendConnect email',
        `Your verification code is ${otp}. It expires in 10 minutes.`
      )
    }

    const userAgent = req.headers.get('user-agent') || undefined
    const token = await createSession(user.id, { userAgent, ip })
    await setSessionCookie(token)
    await audit({ userId: user.id, action: 'register', ip, userAgent })

    return json({
      success: true,
      message: emailVerified ? 'Account created' : 'Account created. Check your email for a verification code.',
      user: {
        id: user.id,
        name: user.name,
        username: user.username,
        email: user.email,
        role: user.role,
      },
    })
  } catch (error: unknown) {
    const err = error as Error
    return errorJson(err.message || 'Registration failed', 500)
  }
}
