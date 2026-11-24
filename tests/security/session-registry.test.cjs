'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { findCurrentSession } = require('../../src/lib/session-registry.cjs')

const tokenA = 'a'.repeat(64)
const tokenB = 'b'.repeat(64)
const now = Date.now()
const row = (userId, token, createdAt = new Date(now - 1000), expiresAt = new Date(now + 60_000)) => ({ userId, token, createdAt, expiresAt })

function store(rows) {
  return {
    session: {
      findUnique: async ({ where }) => rows.find((entry) => entry.token === where.token) || null,
      findMany: async ({ where }) => rows.filter((entry) => entry.userId === where.userId && entry.expiresAt > where.expiresAt.gt && entry.createdAt >= where.createdAt.gte && entry.createdAt <= where.createdAt.lte).slice(0, 2),
    },
  }
}

test('session registry binds the signed NextAuth identity to one active session', async () => {
  const active = row('user-a', tokenA)
  assert.equal((await findCurrentSession(store([active]), { userId: 'user-a', token: tokenA }, now)).token, tokenA)
  assert.equal(await findCurrentSession(store([active]), { userId: 'user-b', token: tokenA }, now), null)
})

test('expired and revoked sessions cannot authenticate', async () => {
  const expired = row('user-a', tokenA, new Date(now - 1000), new Date(now - 1))
  assert.equal(await findCurrentSession(store([expired]), { userId: 'user-a', token: tokenA }, now), null)
  assert.equal(await findCurrentSession(store([]), { userId: 'user-a', token: tokenA }, now), null)
})

test('legacy JWT fallback binds only to one row in the narrow issue-time window', async () => {
  const issuedAt = Math.floor(now / 1000)
  const active = row('user-a', tokenA, new Date(issuedAt * 1000 - 1000))
  assert.equal((await findCurrentSession(store([active]), { userId: 'user-a', issuedAt }, now)).token, tokenA)
  assert.equal(await findCurrentSession(store([active, row('user-a', tokenB)]), { userId: 'user-a', issuedAt }, now), null)
})

test('legacy custom cookie works only while its DB registry row is active', async () => {
  const active = row('user-a', tokenA)
  assert.equal((await findCurrentSession(store([active]), { cookieToken: tokenA }, now)).userId, 'user-a')
  assert.equal(await findCurrentSession(store([]), { cookieToken: tokenA }, now), null)
})
