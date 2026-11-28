'use strict'

/**
 * Audit finding 29: stale `ringing` calls must not stay active indefinitely.
 *
 * Runs `expireStaleRingingCalls` against the real `db-runtime.js` on a throwaway
 * SQLite file. It is not a mock: the rows, the conditional update and the read
 * back all go through the production data layer.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdtemp, rm } = require('fs/promises')
const { tmpdir } = require('os')
const { join, resolve } = require('path')

const repo = resolve(__dirname, '../..')

async function freshRuntime(t, label) {
  const dir = await mkdtemp(join(tmpdir(), `friendconnect-sweep-${label}-`))
  process.env.DATABASE_URL = `file:${join(dir, 'sweep.sqlite')}`
  for (const key of Object.keys(require.cache)) {
    if (key.includes(`${repo}/src/lib/db-runtime.js`) || key.includes(`${repo}/src/lib/db-migrations.cjs`)) {
      delete require.cache[key]
    }
  }
  const runtime = require(join(repo, 'src/lib/db-runtime.js'))
  t.after(async () => {
    try { runtime.prisma.$disconnect?.() } catch {}
    await rm(dir, { recursive: true, force: true })
  })
  return runtime
}

test('stale ringing calls become missed; fresh and answered calls are untouched', async (t) => {
  const { prisma } = await freshRuntime(t, 'basic')
  const { expireStaleRingingCalls } = require(join(repo, 'src/lib/call-sweep.cjs'))

  const a = await prisma.user.create({ data: { email: 'a@x.i', username: 'sweepa', name: 'A', passwordHash: 'h' } })
  const b = await prisma.user.create({ data: { email: 'b@x.i', username: 'sweepb', name: 'B', passwordHash: 'h' } })

  const now = new Date('2026-11-28T12:00:00Z')
  const old = new Date(now.getTime() - 5 * 60 * 1000)
  const fresh = new Date(now.getTime() - 5 * 1000)

  const staleRinging = await prisma.call.create({ data: { callerId: a.id, receiverId: b.id, type: 'audio', status: 'ringing', createdAt: old } })
  const freshRinging = await prisma.call.create({ data: { callerId: a.id, receiverId: b.id, type: 'audio', status: 'ringing', createdAt: fresh } })
  const oldConnected = await prisma.call.create({ data: { callerId: a.id, receiverId: b.id, type: 'video', status: 'connected', createdAt: old } })

  const expired = await expireStaleRingingCalls(prisma, { now, timeoutMs: 60 * 1000 })

  assert.deepEqual(expired.map((c) => c.id), [staleRinging.id], 'only the stale ringing call expires');
  const after = async (id) => prisma.call.findUnique({ where: { id } })
  assert.equal((await after(staleRinging.id)).status, 'missed')
  assert.ok((await after(staleRinging.id)).endedAt, 'endedAt is recorded')
  assert.equal((await after(freshRinging.id)).status, 'ringing')
  assert.equal((await after(oldConnected.id)).status, 'connected', 'connected calls are not swept by the ringing timeout')

  // Idempotent: a second pass finds nothing new.
  assert.deepEqual(await expireStaleRingingCalls(prisma, { now, timeoutMs: 60 * 1000 }), [])
})

test('a call answered between read and write is not marked missed', async (t) => {
  const { prisma } = await freshRuntime(t, 'race')
  const { expireStaleRingingCalls } = require(join(repo, 'src/lib/call-sweep.cjs'))

  const a = await prisma.user.create({ data: { email: 'c@x.i', username: 'sweepc', name: 'C', passwordHash: 'h' } })
  const b = await prisma.user.create({ data: { email: 'd@x.i', username: 'sweepd', name: 'D', passwordHash: 'h' } })
  const now = new Date('2026-11-28T12:00:00Z')
  const call = await prisma.call.create({
    data: { callerId: a.id, receiverId: b.id, type: 'audio', status: 'ringing', createdAt: new Date(now.getTime() - 600000) },
  })

  // Simulate the callee answering after the sweep's read but before its write.
  const realFind = prisma.call.findMany.bind(prisma.call)
  const store = {
    call: {
      findMany: async (args) => {
        const rows = await realFind(args)
        await prisma.call.update({ where: { id: call.id }, data: { status: 'connected' } })
        return rows
      },
      updateMany: (args) => prisma.call.updateMany(args),
    },
  }
  const expired = await expireStaleRingingCalls(store, { now, timeoutMs: 60000 })
  assert.deepEqual(expired, [], 'the conditional update must not overwrite an answered call')
  assert.equal((await prisma.call.findUnique({ where: { id: call.id } })).status, 'connected')
})
