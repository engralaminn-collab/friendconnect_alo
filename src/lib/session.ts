import { cookies, headers } from 'next/headers'
import { db } from '@/lib/db'
import { sessionCookieName, sessionTtlMs, generateToken } from '@/lib/auth'
import { parseDeviceName } from '@/lib/logger'

export interface AuthUser {
  id: string
  email: string
  username: string
  name: string
  role?: string
  emailVerified?: boolean
  twoFactorEnabled?: boolean
}

/**
 * Mark the session cookie `Secure` only when the request really arrived over HTTPS
 * (directly or via Caddy/nginx `X-Forwarded-Proto`). Browsers silently drop Secure
 * cookies on plain http://, so the old "always Secure in production" rule made
 * login do nothing when the site was opened via http://<server-ip>.
 * Override with COOKIE_SECURE=true|false.
 */
async function cookieSecure(): Promise<boolean> {
  const forced = process.env.COOKIE_SECURE
  if (forced === 'true') return true
  if (forced === 'false') return false
  if (process.env.NODE_ENV !== 'production') return false
  try {
    const h = await headers()
    const proto = (h.get('x-forwarded-proto') || '').split(',')[0].trim().toLowerCase()
    if (proto) return proto === 'https'
    const origin = h.get('origin') || h.get('referer') || ''
    if (origin) return origin.startsWith('https:')
  } catch {
    /* outside a request scope */
  }
  return (process.env.APP_ORIGIN || '').startsWith('https:')
}

export async function getSessionUser(): Promise<AuthUser | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(sessionCookieName)?.value
  if (!token) return null
  return getUserByToken(token)
}

export async function createSession(userId: string, opts?: { userAgent?: string; ip?: string }): Promise<string> {
  const token = generateToken()
  const userAgent = opts?.userAgent || null
  const deviceName = userAgent ? parseDeviceName(userAgent) : null
  await db.session.create({
    data: {
      userId,
      token,
      expiresAt: new Date(Date.now() + sessionTtlMs),
      userAgent,
      deviceName,
      ipAddress: opts?.ip || null,
    },
  })
  return token
}

export async function setSessionCookie(token: string) {
  const cookieStore = await cookies()
  cookieStore.set(sessionCookieName, token, {
    httpOnly: true,
    secure: await cookieSecure(),
    sameSite: 'lax',
    path: '/',
    maxAge: sessionTtlMs / 1000,
  })
}

export async function clearSessionCookie() {
  const cookieStore = await cookies()
  cookieStore.set(sessionCookieName, '', {
    httpOnly: true,
    secure: await cookieSecure(),
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  })
}

export async function requireUser(): Promise<AuthUser> {
  const user = await getSessionUser()
  if (!user) throw new Error('UNAUTHORIZED')
  return user
}

export async function requireAdmin(): Promise<AuthUser> {
  const user = await requireUser()
  if (user.role !== 'admin') throw new Error('FORBIDDEN')
  return user
}

export async function getCurrentSessionToken(): Promise<string | null> {
  const cookieStore = await cookies()
  return cookieStore.get(sessionCookieName)?.value ?? null
}

export async function getUserByToken(token: string): Promise<AuthUser | null> {
  if (!token) return null
  const session = await db.session.findUnique({
    where: { token },
    include: { user: true },
  })
  if (!session) return null
  if (session.expiresAt.getTime() < Date.now()) {
    await db.session.delete({ where: { id: session.id } }).catch(() => {})
    return null
  }
  if (Date.now() - session.lastActiveAt.getTime() > 5 * 60 * 1000) {
    await db.session.update({ where: { id: session.id }, data: { lastActiveAt: new Date() } }).catch(() => {})
  }
  return {
    id: session.user.id,
    email: session.user.email,
    username: session.user.username,
    name: session.user.name,
    role: session.user.role,
    emailVerified: session.user.emailVerified,
    twoFactorEnabled: session.user.twoFactorEnabled,
  }
}
