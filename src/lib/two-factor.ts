/**
 * 2FA helpers shared by setup / verify / login / disable / recovery.
 *
 * Finding #6 fixed here:
 *  - `/api/2fa/setup` returned the TOTP secret *and* sent it to
 *    `api.qrserver.com` in a URL, handing the shared secret — the second factor
 *    itself — to a third party. The secret is now returned only as a local
 *    `otpauth://` URI the client renders itself; nothing leaves the server.
 *  - `/api/2fa/disable` needed only the password, so anyone holding a session
 *    could remove the factor. It now requires the password *and* a current TOTP
 *    code, or a backup code.
 *  - An unverified secret was persisted and survived a failed setup, leaving the
 *    account in a state where login would demand a code from a secret the user
 *    never confirmed. Setup writes to `twoFactorSecret` (unconfirmed) and only
 *    `/verify` promotes it to `twoFactorConfirmedSecret`.
 *  - Backup codes were stored as `hashPassword(code + userId)` joined by commas
 *    and never checked at login. They are now SHA-256 digests, one per line, and
 *    each is deleted on use.
 */

import { randomBytes } from 'crypto'
import { db } from '@/lib/db'
import { verifyTotp } from '@/lib/totp'
import { generateBackupCodes, digestBackupCode, normalizeBackupCode } from '@/lib/one-time-code'

/** Number of backup codes issued at enrolment. */
export const BACKUP_CODE_COUNT = 10
/** Failed login challenges before the code is refused until re-auth. */
export const MAX_TOTP_ATTEMPTS = 5

export { generateBackupCodes, digestBackupCode, normalizeBackupCode }

/** Serialise freshly generated codes to the storage format. */
export function serializeBackupCodes(codes: string[]): string {
  return codes.map(digestBackupCode).join('\n')
}

export function parseStoredCodes(stored: string | null | undefined): string[] {
  if (!stored) return []
  return stored
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean)
}

/**
 * Check a backup code and, on success, persist the removal of that code.
 *
 * Returns true only once per code: the stored list is rewritten without the
 * matching digest, so replaying the same code fails.
 */
export async function consumeBackupCode(userId: string, stored: string | null, code: string): Promise<boolean> {
  const digest = digestBackupCode(code)
  const codes = parseStoredCodes(stored)
  if (!codes.includes(digest)) return false

  const remaining = codes.filter((entry) => entry !== digest)
  await db.user.update({
    where: { id: userId },
    data: {
      twoFactorBackup: remaining.length ? remaining.join('\n') : null,
      twoFactorBackupUsed: Number((await db.user.findUnique({ where: { id: userId } }))?.twoFactorBackupUsed ?? 0) + 1,
    },
  })
  return true
}

/**
 * Verify the second factor for a user: a current TOTP code against the
 * confirmed secret, or an unused backup code.
 */
export async function verifySecondFactor(
  user: { id: string; twoFactorConfirmedSecret?: string | null; twoFactorSecret?: string | null; twoFactorBackup?: string | null },
  code: string,
): Promise<{ ok: boolean; method: 'totp' | 'backup' | 'none' }> {
  const trimmed = String(code ?? '').trim()
  if (!trimmed) return { ok: false, method: 'none' }

  const secret = user.twoFactorConfirmedSecret || user.twoFactorSecret
  if (secret && /^\d{6}$/.test(trimmed) && verifyTotp(trimmed, secret)) {
    return { ok: true, method: 'totp' }
  }

  if (await consumeBackupCode(user.id, user.twoFactorBackup ?? null, trimmed)) {
    return { ok: true, method: 'backup' }
  }

  return { ok: false, method: 'none' }
}

/** Cryptographically random id for the code list, kept for clients that index. */
export function newBackupCodeId(): string {
  return randomBytes(8).toString('hex')
}
