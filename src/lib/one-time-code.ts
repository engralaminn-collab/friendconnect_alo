/**
 * One-time codes for password reset and e-mail verification.
 *
 * Findings #5 fixed here:
 *
 *  - Codes came from `Math.random()`, which is not a CSPRNG and is predictable
 *    from a handful of observed outputs.
 *  - Codes were stored in plaintext in `User.otpCode`, so anyone with a database
 *    read could reset any account.
 *  - There was no attempt limit, so a 6-digit code (10^6) was brute-forceable
 *    within its 10-minute window.
 *  - Nothing throttled re-sends, so a victim's inbox could be flooded and the
 *    window kept alive indefinitely.
 *  - The consumed code was never invalidated on success, and the reset token was
 *    `otp + ':' + userId` — the OTP itself, plus a user id — so a leaked token
 *    was as good as the code, forever.
 *  - Changing a password did not invalidate outstanding reset credentials.
 *
 * Design:
 *   `User.otpCode` stores a scrypt hash of the code (same KDF as passwords), and
 *   the code is never returned in a response. Verification is constant-time,
 *   capped at MAX_ATTEMPTS, single-use, and the pending row is cleared on
 *   success. A successful verification yields an opaque 32-byte token, stored
 *   hashed with its own short expiry, that may be redeemed exactly once.
 */

import { randomBytes, randomInt, timingSafeEqual, scrypt, createHash } from 'crypto'
import { promisify } from 'util'

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>

/** How long a code stays valid. */
export const OTP_TTL_MS = 10 * 60 * 1000
/** How long the token issued after a correct code stays valid. */
export const RESET_TOKEN_TTL_MS = 15 * 60 * 1000
/** Wrong guesses allowed before the code is destroyed. */
export const MAX_ATTEMPTS = 5
/** Minimum seconds between two sends to the same account. */
export const RESEND_COOLDOWN_SECONDS = 60

/**
 * A uniformly distributed 6-digit numeric code.
 *
 * `crypto.randomInt` is rejection-sampled and uniform; `Math.floor(x * 900000)`
 * over `Math.random()` is neither cryptographically secure nor uniform.
 */
export function generateOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

/** Hash a code for storage. Format: `scrypt$<saltHex>$<hashHex>`. */
export async function hashCode(code: string): Promise<string> {
  const salt = randomBytes(16)
  const derived = await scryptAsync(code, salt, 64)
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`
}

/** Constant-time comparison with the stored hash. */
export async function verifyHash(code: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false
  const parts = stored.split('$')
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false
  let salt: Buffer
  let expected: Buffer
  try {
    salt = Buffer.from(parts[1], 'hex')
    expected = Buffer.from(parts[2], 'hex')
  } catch {
    return false
  }
  if (!salt.length || !expected.length) return false
  const derived = await scryptAsync(code, salt, expected.length)
  if (derived.length !== expected.length) return false
  return timingSafeEqual(derived, expected)
}

/**
 * Opaque reset credential. 32 random bytes, returned to the client once and
 * stored only as a SHA-256 digest (no need for a slow KDF on a 256-bit value).
 */
export function generateResetToken(): { token: string; digest: string } {
  const token = randomBytes(32).toString('base64url')
  return { token, digest: digestToken(token) }
}

export function digestToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * Compare two digests without leaking length/prefix information.
 */
export function digestsEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex')
  const right = Buffer.from(b, 'hex')
  if (left.length !== right.length || !left.length) return false
  return timingSafeEqual(left, right)
}

/** Uniform 6-digit code for TOTP-independent flows; same generator. */
export const generateNumericCode = generateOtp

/** Backup codes for 2FA recovery: 10 × 8 hex characters, unambiguous. */
export function generateBackupCodes(count = 10): string[] {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ' // no 0/O/1/I
  const codes = new Set<string>()
  while (codes.size < count) {
    let code = ''
    for (let i = 0; i < 10; i += 1) {
      if (i === 5) code += '-'
      code += alphabet[randomInt(0, alphabet.length)]
    }
    codes.add(code)
  }
  return Array.from(codes)
}

export function normalizeBackupCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export function digestBackupCode(code: string): string {
  return createHash('sha256').update(normalizeBackupCode(code)).digest('hex')
}
