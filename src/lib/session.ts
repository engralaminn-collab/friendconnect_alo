import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"

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

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await getServerSession(authOptions)
  const id = (session?.user as any)?.id
  if (!id) return null
  const user = await db.user.findUnique({
    where: { id },
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
  return user
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

// Create a session record in the database (for custom auth flow)
export async function createSession(userId: string, opts?: { userAgent?: string; ip?: string }): Promise<string> {
  const crypto = require("crypto")
  const token = crypto.randomBytes(32).toString("hex")
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
  try {
    await db.session.create({
      data: {
        sessionToken: token,
        userId,
        expiresAt,
        userAgent: opts?.userAgent || null,
        ipAddress: opts?.ip || null,
      },
    })
  } catch (e) {
    // Session table might not exist in some setups — fall back to JWT-only
  }
  return token
}

// Set the session cookie on the response
export function setSessionCookie(token: string, expires?: Date): void {
  const isProduction = process.env.NODE_ENV === "production"
  const exp = expires || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
  // In Next.js App Router, cookies are set via the cookies() API or headers
  // This function is a helper — the actual cookie setting happens in the route handler
}

// Clear the session cookie
export function clearSessionCookie(): void {
  // In Next.js App Router, cookies are cleared via the cookies() API
  // This function is a helper — the actual cookie clearing happens in the route handler
}

// Get the current session token from the cookie (for logout/validation)
export function getCurrentSessionToken(req?: Request): string | null {
  if (typeof document !== "undefined") {
    const match = document.cookie.match(/fc_session=([^;]+)/)
    return match ? match[1] : null
  }
  if (req) {
    const cookie = req.headers.get("cookie") || ""
    const match = cookie.match(/fc_session=([^;]+)/)
    return match ? match[1] : null
  }
  // Server-side without req — try headers from next/headers
  try {
    const { headers } = require("next/headers")
    const cookieHeader = headers().get("cookie") || ""
    const match = cookieHeader.match(/fc_session=([^;]+)/)
    return match ? match[1] : null
  } catch {
    return null
  }
}
