import type { NextAuthOptions } from "next-auth"
import CredentialsProvider from "next-auth/providers/credentials"
import bcrypt from "bcryptjs"
import { randomBytes } from "crypto"
import { db } from "@/lib/db"
import { MAX_TOTP_ATTEMPTS, verifySecondFactor } from "@/lib/two-factor"

const DEV_SECRET = "friendconnect-dev-secret-change-in-production"

/**
 * Resolve the NextAuth signing secret.
 *
 * Refusing to boot in production without a real secret is deliberate: the
 * well-known dev fallback is in the repository, so falling back to it in
 * production would let anyone mint valid session JWTs and WebSocket tokens.
 */
function resolveSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET
  if (secret && secret.length > 0) return secret
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "NEXTAUTH_SECRET is required in production. Generate one with: openssl rand -base64 32"
    )
  }
  return DEV_SECRET
}

/**
 * Create the DB session row that the realtime server authenticates against.
 *
 * `Session.token` is NOT NULL + UNIQUE and the socket server looks sessions up
 * by it, so this must happen on every successful credential login — otherwise
 * /api/auth/token returns 404 and the socket cannot authenticate at all.
 * The DB row is the revocation authority for both API and realtime sessions,
 * so login must fail closed if this row cannot be created.
 */
async function ensureSessionRow(userId: string, userAgent: string): Promise<string> {
  const token = randomBytes(32).toString("hex")
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
  await db.session.create({
    data: {
      userId,
      // `Session.token` and `Session.sessionToken` both exist: the first is what
      // the realtime server authenticates against, the second is the legacy
      // column NextAuth-era rows were keyed by. Both are NOT NULL in the
      // canonical schema, so they must be written together.
      token,
      sessionToken: token,
      expiresAt,
      userAgent,
      lastActiveAt: new Date(),
    },
  })
  return token
}

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        identifier: { label: "Email or username", type: "text" },
        password: { label: "Password", type: "password" },
        // Only required when the account has 2FA enabled; the login form
        // re-submits with this field populated after the challenge.
        totp: { label: "Two-factor code", type: "text" },
      },
      async authorize(credentials, req) {
        if (!credentials?.identifier || !credentials?.password) return null
        const ident = credentials.identifier.trim().toLowerCase()
        const user = await db.user.findFirst({
          where: { OR: [{ email: ident }, { username: ident }] },
        })
        if (!user) return null
        const ok = await bcrypt.compare(credentials.password, user.passwordHash)
        if (!ok) return null

        // Enforce 2FA here too: this is the path the UI actually logs in
        // through, so checking it only in /api/auth/login would leave 2FA
        // users able to sign in with a password alone.
        if (user.twoFactorEnabled) {
          // Finding #6: the challenge accepts a current TOTP code *or* an unused
          // backup code. Backup codes were previously generated at enrolment and
          // then never checked anywhere, so recovering a lost device was
          // impossible. verifySecondFactor also consumes a backup code on use.
          const code = String(
            (credentials as Record<string, unknown>).totp ??
              (credentials as Record<string, unknown>).backupCode ??
              ""
          ).trim()
          if (!code) return null

          if (Number(user.twoFactorAttempts ?? 0) >= MAX_TOTP_ATTEMPTS) return null

          const second = await verifySecondFactor(user, code)
          if (!second.ok) {
            await db.user.update({
              where: { id: user.id },
              data: { twoFactorAttempts: Number(user.twoFactorAttempts ?? 0) + 1 },
            })
            return null
          }
          await db.user.update({ where: { id: user.id }, data: { twoFactorAttempts: 0 } })
        }

        await db.user.update({
          where: { id: user.id },
          data: { lastSeenAt: new Date() },
        })
        const sessionToken = await ensureSessionRow(
          user.id,
          String((req as { headers?: Record<string, string> })?.headers?.["user-agent"] ?? "")
        )
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          username: user.username,
          sessionToken,
        } as any
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = (user as any).id
        token.username = (user as any).username
        token.sessionToken = (user as any).sessionToken
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        ;(session.user as any).id = token.id
        ;(session.user as any).username = token.username
        ;(session.user as any).sessionToken = token.sessionToken
        ;(session.user as any).sessionIssuedAt = token.iat
      }
      return session
    },
  },
  pages: { signIn: "/" },
  secret: resolveSecret(),
  debug: false,
}


// === Additional auth exports required by API routes ===

// Hash a password with bcrypt (10 rounds)
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10)
}

// Synchronous version for use in places that can't await (Prisma data objects)
export function hashPasswordSync(plain: string): string {
  return bcrypt.hashSync(plain, 10)
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

// Generate a 6-digit OTP code.
//
// Kept as a re-export so existing imports keep working, but the implementation
// lives in one-time-code.ts and uses crypto.randomInt. The previous
// Math.random() version (finding #5) is not predictable-safe.
export { generateOtp } from "./one-time-code"

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
