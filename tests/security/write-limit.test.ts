/**
 * Audit finding 28: a global floor on state-changing API requests.
 * Calls the real `proxy` function with real NextRequest objects.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { proxy } from '../../src/proxy'
import { writeLimitKey, WRITE_LIMIT_MAX } from '../../src/lib/write-limit'

let seq = 0
const uniq = (label: string) => `${label}-${Date.now()}-${++seq}`

function req(method: string, path: string, headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost${path}`, { method, headers })
}

test('GET requests are never counted against the write limit', async () => {
  const cookie = `fc_session=${uniq('get')}`
  for (let i = 0; i < WRITE_LIMIT_MAX + 10; i++) {
    const res = await proxy(req('GET', '/api/conversations', { cookie }))
    assert.notEqual(res.status, 429)
  }
})

test('the 241st write from one session is refused with 429 and Retry-After', async () => {
  const cookie = `fc_session=${uniq('burst')}`
  for (let i = 0; i < WRITE_LIMIT_MAX; i++) {
    const res = await proxy(req('POST', '/api/friends', { cookie }))
    assert.notEqual(res.status, 429, `write ${i + 1} must be allowed`)
  }
  const refused = await proxy(req('POST', '/api/friends', { cookie }))
  assert.equal(refused.status, 429)
  assert.equal(refused.headers.get('retry-after'), '60')
  assert.match(await refused.text(), /Too many requests/)
})

test('one session exhausting its budget does not throttle another session', async () => {
  const busy = `fc_session=${uniq('busy')}`
  const quiet = `fc_session=${uniq('quiet')}`
  for (let i = 0; i < WRITE_LIMIT_MAX + 1; i++) await proxy(req('PUT', '/api/profile', { cookie: busy }))
  assert.equal((await proxy(req('PUT', '/api/profile', { cookie: busy }))).status, 429)
  assert.notEqual((await proxy(req('PUT', '/api/profile', { cookie: quiet }))).status, 429)
})

test('anonymous writes are bucketed by client IP, separately from sessions', async () => {
  const ip = `203.0.113.${(++seq % 200) + 1}`
  for (let i = 0; i < WRITE_LIMIT_MAX; i++) await proxy(req('POST', '/api/auth/login', { 'x-forwarded-for': ip }))
  assert.equal((await proxy(req('POST', '/api/auth/login', { 'x-forwarded-for': ip }))).status, 429)
  const withSession = await proxy(req('POST', '/api/friends', { 'x-forwarded-for': ip, cookie: `fc_session=${uniq('mix')}` }))
  assert.notEqual(withSession.status, 429, 'a session has its own bucket even from a limited IP')
})

test('the realtime callback is exempt only with the correct internal secret', async () => {
  const secret = process.env.SOCKET_INTERNAL_SECRET || process.env.NEXTAUTH_SECRET || 'friendconnect-dev-secret-change-in-production'
  const good = { 'x-internal-secret': secret, 'x-forwarded-for': `198.51.100.${(++seq % 200) + 1}` }
  for (let i = 0; i < WRITE_LIMIT_MAX + 20; i++) {
    const res = await proxy(req('POST', '/api/jara/respond', good))
    assert.notEqual(res.status, 429, 'the internal callback must not be throttled')
  }
  const wrong = { 'x-internal-secret': 'not-the-secret', 'x-forwarded-for': `198.51.100.${(++seq % 200) + 1}` }
  for (let i = 0; i < WRITE_LIMIT_MAX; i++) await proxy(req('POST', '/api/jara/respond', wrong))
  assert.equal((await proxy(req('POST', '/api/jara/respond', wrong))).status, 429, 'a wrong secret gets no exemption')
})

test('the internal exemption applies only to the callback path', async () => {
  const secret = process.env.SOCKET_INTERNAL_SECRET || process.env.NEXTAUTH_SECRET || 'friendconnect-dev-secret-change-in-production'
  const headers = { 'x-internal-secret': secret, 'x-forwarded-for': `192.0.2.${(++seq % 200) + 1}` }
  for (let i = 0; i < WRITE_LIMIT_MAX; i++) await proxy(req('POST', '/api/friends', headers))
  assert.equal((await proxy(req('POST', '/api/friends', headers))).status, 429, 'a valid secret does not lift the limit elsewhere')
})

test('security headers are present on a 429 response', async () => {
  const cookie = `fc_session=${uniq('hdr')}`
  for (let i = 0; i < WRITE_LIMIT_MAX + 1; i++) await proxy(req('DELETE', '/api/friends', { cookie }))
  const refused = await proxy(req('DELETE', '/api/friends', { cookie }))
  assert.equal(refused.status, 429)
  assert.equal(refused.headers.get('x-frame-options'), 'DENY')
  assert.equal(refused.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(refused.headers.get('cache-control'), 'no-store')
})

test('the bucket key never contains the raw session token', () => {
  const token = 'super-secret-session-token-value-0123456789'
  const key = writeLimitKey(`fc_session=${token}`, null, null)
  assert.ok(!key.includes(token), 'the raw token must not appear in the cache key')
  assert.match(key, /^write:session:[0-9a-f]{32}$/)
})
