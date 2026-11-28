/**
 * Audit finding 19: TOTP replay resistance.
 *
 * Uses the real TOTP functions and the real cache-backed claim. REDIS_URL is unset
 * in tests, so the claim is process-local, which is what these tests need.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { generateTotp, matchTotpCounter, verifyTotp } from '../../src/lib/totp'

// Test-only base32 secret. It protects nothing and is not a deployment value.
const SECRET = 'JBSWY3DPEHPK3PXP'

test('matchTotpCounter returns a counter for the current code and null for a code that cannot match', () => {
  const now = Date.now()
  const current = generateTotp(SECRET, 0)
  assert.equal(typeof matchTotpCounter(current, SECRET, 1, now), 'number')
  // A code that is not the current code must not match at window 0.
  const other = current === '000000' ? '111111' : '000000'
  assert.equal(matchTotpCounter(other, SECRET, 0, now), null)
  assert.equal(matchTotpCounter('12345', SECRET, 1, now), null, 'five digits never match')
})

test('the ±1 window accepts the adjacent steps', () => {
  assert.equal(verifyTotp(generateTotp(SECRET, 1), SECRET, 1), true)
  assert.equal(verifyTotp(generateTotp(SECRET, -1), SECRET, 1), true)
})

test('verifyTotp keeps its boolean contract', () => {
  assert.equal(verifyTotp(generateTotp(SECRET, 0), SECRET), true)
  assert.equal(verifyTotp('abcdef', SECRET), false)
})

test('verifyTotpOnce accepts a code once and refuses the replay', async () => {
  const { verifyTotpOnce } = await import('../../src/lib/two-factor')
  const code = generateTotp(SECRET, 0)
  const userId = `replay-user-${Date.now()}-${Math.random()}`
  assert.equal(await verifyTotpOnce(userId, code, SECRET), true, 'first use is accepted')
  assert.equal(await verifyTotpOnce(userId, code, SECRET), false, 'the replay is refused')
})

test('the replay claim is per user: a second account with the same code is unaffected', async () => {
  const { verifyTotpOnce } = await import('../../src/lib/two-factor')
  const code = generateTotp(SECRET, 0)
  const stamp = `${Date.now()}-${Math.random()}`
  assert.equal(await verifyTotpOnce(`a-${stamp}`, code, SECRET), true)
  assert.equal(await verifyTotpOnce(`b-${stamp}`, code, SECRET), true)
})

test('a wrong code is refused and does not consume the real code', async () => {
  const { verifyTotpOnce } = await import('../../src/lib/two-factor')
  const userId = `wrong-${Date.now()}-${Math.random()}`
  const current = generateTotp(SECRET, 0)
  const wrong = current === '000000' ? '111111' : '000000'
  assert.equal(await verifyTotpOnce(userId, wrong, SECRET), false)
  assert.equal(await verifyTotpOnce(userId, current, SECRET), true, 'the real code still works after a wrong attempt')
})

test('verifySecondFactor refuses a replayed TOTP and falls through to backup codes', async () => {
  const { verifySecondFactor } = await import('../../src/lib/two-factor')
  const code = generateTotp(SECRET, 0)
  const user = { id: `sf-${Date.now()}-${Math.random()}`, twoFactorConfirmedSecret: SECRET, twoFactorSecret: SECRET, twoFactorBackup: null }
  assert.deepEqual(await verifySecondFactor(user, code), { ok: true, method: 'totp' })
  assert.deepEqual(await verifySecondFactor(user, code), { ok: false, method: 'none' })
})
