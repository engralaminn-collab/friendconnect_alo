'use strict'

/**
 * Audit finding 26: expired sessions are removed; live sessions are kept.
 * Runs against the real db-runtime on a throwaway SQLite file.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdtemp, rm } = require('fs/promises')
const { tmpdir } = require('os')
const { join, resolve } = require('path')

const repo = resolve(__dirname, '../..')

test('expired sessions are deleted, unexpired sessions survive', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'friendconnect-session-sweep-'))
  process.env.DATABASE_URL = `file:${join(dir, 'sessions.sqlite')}`
  for (const key of Object.keys(require.cache)) {
    if (key.includes(`${repo}/src/lib/db-runtime.js`) || key.includes(`${repo}/src/lib/db-migrations.cjs`)) delete require.cache[key]
  }
  const { prisma } = require(join(repo, 'src/lib/db-runtime.js'))
  t.after(async () => { try { prisma.$disconnect?.() } catch {}; await rm(dir, { recursive: true, force: true }) })
  const { deleteExpiredSessions } = require(join(repo, 'src/lib/session-sweep.cjs'))

  const user = await prisma.user.create({ data: { email: 's@x.i', username: 'sesssweep', name: 'S', passwordHash: 'h' } })
  const now = new Date('2026-11-28T12:00:00Z')
  const expired = await prisma.session.create({ data: { userId: user.id, sessionToken: 'tok-expired', expiresAt: new Date(now.getTime() - 1000) } })
  const live = await prisma.session.create({ data: { userId: user.id, sessionToken: 'tok-live', expiresAt: new Date(now.getTime() + 86400000) } })

  assert.equal(await deleteExpiredSessions(prisma, now), 1)
  assert.equal(await prisma.session.findUnique({ where: { id: expired.id } }), null)
  assert.ok(await prisma.session.findUnique({ where: { id: live.id } }), 'a live session must survive')
  assert.equal(await deleteExpiredSessions(prisma, now), 0, 'second pass is a no-op')
})
