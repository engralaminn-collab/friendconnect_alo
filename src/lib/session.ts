import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { findCurrentSession } from "./session-registry.cjs"

export type CurrentUser = {
  id: string
  username: string
  name: string
  email: string
  avatarUrl: string | null
  bio: string | null
  status: string
  role: string
  emailVerified: Date | null
  twoFactorEnabled: boolean
  twoFactorSecret: string | null
  fileUsedBytes: number
  fileQuotaBytes: number
}

export async function getLegacyCookieSessionToken(req?: Request): Promise<string | null> {
  if (req) {
    const match = (req.headers.get('cookie') || '').match(/(?:^|;\s*)fc_session=([^;]+)/)
    return match ? decodeURIComponent(match[1]) : null
  }
  try {
    const { cookies } = await import('next/headers')
    return (await cookies()).get('fc_session')?.value || null
  } catch {
    return null
  }
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const nextAuthSession = await getServerSession(authOptions).catch(() => null)
  const nextAuthUser = nextAuthSession?.user as any
  const cookieToken = await getLegacyCookieSessionToken()
  const registry = await findCurrentSession(db, {
    userId: typeof nextAuthUser?.id === 'string' ? nextAuthUser.id : null,
    token: typeof nextAuthUser?.sessionToken === 'string' ? nextAuthUser.sessionToken : null,
    issuedAt: nextAuthUser?.sessionIssuedAt,
    cookieToken,
  } as any).catch(() => null)
  if (!registry) return null
  return db.user.findUnique({
    where: { id: registry.userId },
    select: {
      id: true,
      username: true,
      name: true,
      email: true,
      avatarUrl: true,
      bio: true,
      status: true,
      role: true,
      emailVerified: true,
      twoFactorEnabled: true,
      twoFactorSecret: true,
      fileUsedBytes: true,
      fileQuotaBytes: true,
    },
  })
}

export async function requireUser(): Promise<CurrentUser> {
  const u = await getCurrentUser()
  if (!u) throw new Error("UNAUTHORIZED")
  return u
}


// === Additional session exports required by API routes ===

// Alias for getCurrentUser — many routes import getSessionUser
export async function getSessionUser(): Promise<CurrentUser | null> {
  return getCurrentUser()
}

// Create a session record in the database.
//
// `Session.token` is the column the realtime server authenticates against
// (NOT NULL + UNIQUE), so it must always be written. `sessionToken` is the
// legacy column NextAuth-era rows were keyed by and is also NOT NULL in the
// canonical schema, so both are populated with the same value (see
// `ensureSessionRow` in auth.ts, which does the same for the NextAuth path).
export async function createSession(userId: string, opts?: { userAgent?: string; ip?: string }): Promise<string> {
  const crypto = require("crypto")
  const token = crypto.randomBytes(32).toString("hex")
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
  await db.session.create({
    data: {
      token,
      sessionToken: token,
      userId,
      expiresAt,
      userAgent: opts?.userAgent || null,
      ipAddress: opts?.ip || null,
      lastActiveAt: new Date(),
    },
  })
  return token
}

const SESSION_COOKIE = "fc_session"
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

function cookieOptions(expires?: Date) {
  // Secure is forced in production; over plain-HTTP dev it must stay off or
  // the cookie would never be stored by the browser.
  const secure =
    process.env.COOKIE_SECURE === "true" ||
    (process.env.COOKIE_SECURE !== "false" && process.env.NODE_ENV === "production")
  return {
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: "/",
    expires: expires || new Date(Date.now() + SESSION_TTL_MS),
  }
}

// Set the session cookie. Must be called from a route handler / server action,
// where next/headers is available.
export async function setSessionCookie(token: string, expires?: Date): Promise<void> {
  const { cookies } = await import("next/headers")
  ;(await cookies()).set(SESSION_COOKIE, token, cookieOptions(expires))
}

// Clear the session cookie.
export async function clearSessionCookie(): Promise<void> {
  const { cookies } = await import("next/headers")
  ;(await cookies()).set(SESSION_COOKIE, "", { ...cookieOptions(), expires: new Date(0) })
}

// Get the current session token from the cookie (for logout/validation)
export async function getCurrentSessionToken(req?: Request): Promise<string | null> {
  const nextAuthSession = req ? null : await getServerSession(authOptions).catch(() => null)
  const nextAuthUser = nextAuthSession?.user as any
  const cookieToken = await getLegacyCookieSessionToken(req)
  const registry = await findCurrentSession(db, {
    userId: typeof nextAuthUser?.id === 'string' ? nextAuthUser.id : null,
    token: typeof nextAuthUser?.sessionToken === 'string' ? nextAuthUser.sessionToken : null,
    issuedAt: nextAuthUser?.sessionIssuedAt,
    cookieToken,
  } as any).catch(() => null)
  return registry?.token || null
}
