/**
 * Audit findings 14 and 19: backup-code atomicity, one-time-code limits, and
 * the verify-otp route's responses, against the real handlers and a temp SQLite file.
 */
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { openTempDatabase } from '../support/temp-db'

const temp = openTempDatabase('otp-backup')
let db: any
let consumeBackupCode: any
let serializeBackupCodes: any
let hashCode: any
let POST: any
let NextRequest: any

let seq = 0
const uniq = () => `${Date.now()}${++seq}`

async function makeUser(extra: Record<string, unknown> = {}) {
  const n = uniq()
  return db.user.create({
    data: { email: `u${n}@otp.test`, username: `u${n}`, name: 'U', passwordHash: 'x', ...extra },
  })
}

function verifyRequest(body: unknown, ip: string) {
  return new NextRequest('http://localhost/api/auth/verify-otp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  })
}

before(async () => {
  db = (await import('../../src/lib/db')).db
  ;({ consumeBackupCode, serializeBackupCodes } = await import('../../src/lib/two-factor'))
  ;({ hashCode } = await import('../../src/lib/one-time-code'))
  ;({ POST } = await import('../../src/app/api/auth/verify-otp/route'))
  ;({ NextRequest } = await import('next/server'))
})

after(() => temp.cleanup())

test('finding 14: eight concurrent consumptions of one backup code succeed exactly once', async () => {
  const stored = serializeBackupCodes(['abcd-1234', 'efgh-5678'])
  const user = await makeUser({ twoFactorBackup: stored, twoFactorEnabled: true })
  const results = await Promise.all(
    Array.from({ length: 8 }, () => consumeBackupCode(user.id, stored, 'abcd-1234')),
  )
  assert.equal(results.filter(Boolean).length, 1, `expected exactly one winner, got ${results.filter(Boolean).length}`)
  const row = await db.user.findUnique({ where: { id: user.id } })
  assert.ok(row.twoFactorBackup && row.twoFactorBackup.split('\n').length === 1, 'the consumed code was removed, the other kept')
})

test('finding 14: a consumed backup code is refused on replay, even with the old stored value', async () => {
  const stored = serializeBackupCodes(['wxyz-0001'])
  const user = await makeUser({ twoFactorBackup: stored, twoFactorEnabled: true })
  assert.equal(await consumeBackupCode(user.id, stored, 'wxyz-0001'), true)
  assert.equal(await consumeBackupCode(user.id, stored, 'wxyz-0001'), false, 'stale stored value must not succeed')
  const row = await db.user.findUnique({ where: { id: user.id } })
  assert.equal(row.twoFactorBackup, null)
})

test('finding 19: a correct one-time code succeeds once and the replay is refused', async () => {
  const code = '424242'
  const user = await makeUser({ otpCode: await hashCode(code), otpExpiry: new Date(Date.now() + 600000), otpAttempts: 0 })
  const ip = `10.1.0.${seq}`
  const first = await POST(verifyRequest({ email: user.email, otp: code }, ip))
  assert.equal(first.status, 200)
  const body = await first.json()
  assert.equal(typeof body.resetToken, 'string')
  const replay = await POST(verifyRequest({ email: user.email, otp: code }, ip))
  assert.notEqual(replay.status, 200, 'the same one-time code must not succeed twice')
})

test('finding 19: after five wrong attempts the code is burned, even when presented correctly', async () => {
  const code = '135790'
  const user = await makeUser({ otpCode: await hashCode(code), otpExpiry: new Date(Date.now() + 600000), otpAttempts: 0 })
  const ip = `10.2.0.${seq}`
  for (let i = 0; i < 5; i++) {
    const r = await POST(verifyRequest({ email: user.email, otp: '000000' }, ip))
    assert.notEqual(r.status, 200)
  }
  const after5 = await POST(verifyRequest({ email: user.email, otp: code }, ip))
  assert.notEqual(after5.status, 200, 'the correct code must not work after the attempt limit')
  const row = await db.user.findUnique({ where: { id: user.id } })
  assert.equal(row.otpCode, null)
})

test('finding 19: an expired one-time code is refused', async () => {
  const code = '246800'
  const user = await makeUser({ otpCode: await hashCode(code), otpExpiry: new Date(Date.now() - 1000), otpAttempts: 0 })
  const r = await POST(verifyRequest({ email: user.email, otp: code }, `10.3.0.${seq}`))
  assert.notEqual(r.status, 200)
})

test('finding 19: an unknown account gets the same refusal as a wrong code (no enumeration)', async () => {
  const user = await makeUser({ otpCode: await hashCode('111222'), otpExpiry: new Date(Date.now() + 600000), otpAttempts: 0 })
  const ip = `10.4.0.${seq}`
  const wrong = await POST(verifyRequest({ email: user.email, otp: '999999' }, ip))
  const unknown = await POST(verifyRequest({ email: `nobody-${uniq()}@otp.test`, otp: '999999' }, ip))
  assert.equal(wrong.status, unknown.status)
  const a = await wrong.json()
  const b = await unknown.json()
  // requestId is per request by design; the refusal itself must be identical.
  assert.deepEqual({ error: a.error, code: a.code }, { error: b.error, code: b.code })
})
