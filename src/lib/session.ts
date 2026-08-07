import { cookies } from 'next/headers'
import { db } from '@/lib/db'
import { sessionCookieName, sessionTtlMs } from '@/lib/auth'

export interface AuthUser {
  id: string
  email: string
  username: string
  name: string
}

export async function getSessionUser(): Promise<AuthUser | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(sessionCookieName)?.value
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
  return {
    id: session.user.id,
    email: session.user.email,
    username: session.user.username,
    name: session.user.name,
  }
}

export async function createSession(userId: string): Promise<string> {
  const { generateToken } = await import('@/lib/auth')
  const token = generateToken()
  await db.session.create({
    data: {
      userId,
      token,
      expiresAt: new Date(Date.now() + sessionTtlMs),
    },
  })
  return token
}

export async function setSessionCookie(token: string) {
  const cookieStore = await cookies()
  cookieStore.set(sessionCookieName, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: sessionTtlMs / 1000,
  })
}

export async function clearSessionCookie() {
  const cookieStore = await cookies()
  cookieStore.delete(sessionCookieName)
}

export async function requireUser(): Promise<AuthUser> {
  const user = await getSessionUser()
  if (!user) throw new Error('UNAUTHORIZED')
  return user
}

// Validate a session token from external services (websocket). Returns user id or null.
export async function getUserByToken(token: string): Promise<AuthUser | null> {
  const session = await db.session.findUnique({
    where: { token },
    include: { user: true },
  })
  if (!session) return null
  if (session.expiresAt.getTime() < Date.now()) return null
  return {
    id: session.user.id,
    email: session.user.email,
    username: session.user.username,
    name: session.user.name,
  }
}
