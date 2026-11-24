import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { verifyPassword, needsRehash, hashPassword, clientIp, validatePassword } from '@/lib/auth'
import { createSession, setSessionCookie } from '@/lib/session'
import { MAX_TOTP_ATTEMPTS, verifySecondFactor } from '@/lib/two-factor'
import { audit } from '@/lib/audit'
import { errorJson, json } from '@/lib/serialize'
import { rateLimit } from '@/lib/cache'
import { handleRouteError } from '@/lib/api-errors'

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

      // Finding #6: honour an unused backup code here too, so losing the
      // authenticator does not lock the account out permanently, and cap the
      // number of failed challenges.
      if (Number(user.twoFactorAttempts ?? 0) >= MAX_TOTP_ATTEMPTS) {
        await audit({ userId: user.id, action: 'login_2fa_locked', ip })
        return errorJson('Too many incorrect codes. Try again later.', 429)
      }

      const second = await verifySecondFactor(user, String(totp))
      if (!second.ok) {
        await db.user.update({
          where: { id: user.id },
          data: { twoFactorAttempts: Number(user.twoFactorAttempts ?? 0) + 1 },
        })
        await audit({ userId: user.id, action: 'login_2fa_failed', ip })
        return errorJson('Invalid authenticator code', 401)
      }
      if (second.method === 'backup') {
        await audit({ userId: user.id, action: 'login_2fa_backup_code_used', ip })
      }
      await db.user.update({ where: { id: user.id }, data: { twoFactorAttempts: 0 } })
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
  } catch (error) {
    return handleRouteError(error, 'POST /api/auth/login')
  }
}
