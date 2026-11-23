import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { verifyPassword, needsRehash, hashPassword, clientIp, validatePassword } from '@/lib/auth'
import { createSession, setSessionCookie } from '@/lib/session'
import { verifyTotp } from '@/lib/totp'
import { audit } from '@/lib/audit'
import { errorJson, json } from '@/lib/serialize'
import { rateLimit } from '@/lib/cache'

export async function POST(req: NextRequest) {
  try {
    const ip = clientIp(req) || 'unknown'
    const rl = await rateLimit(`login:${ip}`, 10, 60)
    if (!rl.allowed) return errorJson('Too many login attempts. Try again in a minute.', 429)

    const body = await req.json()
    const { login, identifier, email, username, phone, password, totp } = body as Record<string, string>
    const userInput = String(login || identifier || email || username || phone || '').trim().toLowerCase()

    if (!userInput || !password) {
      return errorJson('Username/email and password are required', 400)
    }

    const user = await db.user.findFirst({
      where: { OR: [{ username: userInput }, { email: userInput }] },
    })

    const passwordOk = user?.passwordHash ? await verifyPassword(password, user.passwordHash) : false
    if (!user || !user.passwordHash || !passwordOk) {
      await audit({ action: 'login_failed', ip, meta: { identifier: userInput } })
      return errorJson('Invalid username/email or password', 401)
    }

    if (user.twoFactorEnabled) {
      if (!totp) {
        return json({ requires2fa: true, message: 'Two-factor authentication required' }, 200)
      }
      const totpOk = user.twoFactorSecret ? verifyTotp(String(totp), user.twoFactorSecret) : false
      if (!totpOk) {
        return errorJson('Invalid authenticator code', 401)
      }
    }

    if (needsRehash(user.passwordHash)) {
      const pwErr = validatePassword(password)
      if (pwErr.valid) {
        await db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(password) } })
      }
    }

    const userAgent = req.headers.get('user-agent') || undefined
    const token = await createSession(user.id, { userAgent, ip })
    await setSessionCookie(token)
    await audit({ userId: user.id, action: 'login', ip, userAgent })

    return json({
      success: true,
      message: 'Logged in',
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
    return errorJson(err.message || 'Login failed', 500)
  }
}
