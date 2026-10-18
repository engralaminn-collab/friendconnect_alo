import { scryptSync, randomBytes, timingSafeEqual, createHash, randomInt } from 'crypto'

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `scrypt:${salt}:${hash}`
}

function safeEqualHex(a: string, b: string): boolean {
  try {
    const aBuf = Buffer.from(a, 'hex')
    const bBuf = Buffer.from(b, 'hex')
    if (aBuf.length !== bBuf.length || aBuf.length === 0) return false
    return timingSafeEqual(aBuf, bBuf)
  } catch {
    return false
  }
}

function sha256Hex(password: string): string {
  return createHash('sha256').update(password).digest('hex')
}

/**
 * Verify a password against stored hashes.
 * Canonical format: scrypt:salt:hash
 * Legacy formats accepted then rehashed on login:
 *   - salt:hash (old scrypt without prefix)
 *   - 64-char hex SHA-256
 *   - bcrypt $2a$/$2b$/$2y$ (not verified here without bcryptjs — rejected)
 */
export function verifyPassword(password: string, stored: string): boolean {
  if (!password || !stored) return false

  if (stored.startsWith('scrypt:')) {
    const parts = stored.split(':')
    if (parts.length !== 3) return false
    const [, salt, hash] = parts
    const test = scryptSync(password, salt, 64).toString('hex')
    return safeEqualHex(hash, test)
  }

  if (stored.includes(':') && !stored.startsWith('$')) {
    const [salt, hash] = stored.split(':')
    if (!salt || !hash) return false
    const test = scryptSync(password, salt, 64).toString('hex')
    return safeEqualHex(hash, test)
  }

  if (/^[a-f0-9]{64}$/i.test(stored)) {
    return safeEqualHex(stored.toLowerCase(), sha256Hex(password))
  }

  // Never accept plaintext equality.
  return false
}

export function needsRehash(stored: string): boolean {
  return !stored.startsWith('scrypt:')
}

export function generateToken(): string {
  return randomBytes(32).toString('hex')
}

export function generateOtp(): string {
  return randomInt(100000, 1000000).toString()
}

const SESSION_COOKIE = 'fc_session'
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30 // 30 days

export const sessionCookieName = SESSION_COOKIE
export const sessionTtlMs = SESSION_TTL_MS

export function isEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
}

export function sanitizeUsername(v: string): string {
  return v.trim().toLowerCase().replace(/[^a-z0-9_.]/g, '')
}

export function validatePassword(v: string): string | null {
  if (v.length < 8) return 'Password must be at least 8 characters'
  if (v.length > 100) return 'Password too long'
  if (!/[A-Za-z]/.test(v) || !/[0-9]/.test(v)) {
    return 'Password must include a letter and a number'
  }
  return null
}

export function clientIp(req: { headers: Headers }): string | undefined {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0]?.trim()
  return req.headers.get('x-real-ip') || undefined
}
