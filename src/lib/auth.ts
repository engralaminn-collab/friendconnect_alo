import type { NextAuthOptions } from "next-auth"
import CredentialsProvider from "next-auth/providers/credentials"
import bcrypt from "bcryptjs"
import { db } from "@/lib/db"

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        identifier: { label: "Email or username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.identifier || !credentials?.password) return null
        const ident = credentials.identifier.trim().toLowerCase()
        const user = await db.user.findFirst({
          where: { OR: [{ email: ident }, { username: ident }] },
        })
        if (!user) return null
        const ok = await bcrypt.compare(credentials.password, user.passwordHash)
        if (!ok) return null
        await db.user.update({
          where: { id: user.id },
          data: { lastSeenAt: new Date() },
        })
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          username: user.username,
        } as any
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = (user as any).id
        token.username = (user as any).username
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        ;(session.user as any).id = token.id
        ;(session.user as any).username = token.username
      }
      return session
    },
  },
  pages: { signIn: "/" },
  secret: process.env.NEXTAUTH_SECRET || "friendconnect-dev-secret-change-in-production",
  debug: false,
}


// === Additional auth exports required by API routes ===

// Hash a password with bcrypt (10 rounds)
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10)
}

// Verify a password against a bcrypt hash
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(plain, hash)
  } catch {
    return false
  }
}

// Check if a hash needs rehashing (bcrypt cost < 10)
export function needsRehash(hash: string): boolean {
  try {
    const rounds = bcrypt.getRounds(hash)
    return rounds < 10
  } catch {
    return true
  }
}

// Validate password strength (min 8 chars, has letter + number)
export function validatePassword(password: string): { valid: boolean; reason?: string } {
  if (!password || password.length < 8) {
    return { valid: false, reason: "Password must be at least 8 characters" }
  }
  if (!/[a-zA-Z]/.test(password)) {
    return { valid: false, reason: "Password must contain at least one letter" }
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, reason: "Password must contain at least one number" }
  }
  return { valid: true }
}

// Generate a 6-digit OTP code
export function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

// Extract client IP from request headers (for rate limiting / audit)
export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")
  if (forwarded) return forwarded.split(",")[0].trim()
  const real = req.headers.get("x-real-ip")
  if (real) return real
  const cf = req.headers.get("cf-connecting-ip")
  if (cf) return cf
  return "unknown"
}
