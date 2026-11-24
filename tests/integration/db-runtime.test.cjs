'use strict'

/**
 * Database runtime behaviour (findings #2, #7, #9 and the relation bug found
 * while testing the socket handshake).
 *
 * These run the real `src/lib/db-runtime.js` against a throwaway SQLite file, so
 * they assert what the application actually does rather than what a mock says.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdtemp, rm } = require('fs/promises')
const { tmpdir } = require('os')
const { join, resolve } = require('path')

const repo = resolve(__dirname, '../..')

async function freshRuntime(t, label) {
  const dir = await mkdtemp(join(tmpdir(), `friendconnect-runtime-${label}-`))
  process.env.DATABASE_URL = `file:${join(dir, 'runtime.sqlite')}`

  // Each test needs its own module instance: the runtime caches the client.
  for (const key of Object.keys(require.cache)) {
    if (key.includes(`${repo}/src/lib/db-runtime.js`) || key.includes(`${repo}/src/lib/db-migrations.cjs`)) {
      delete require.cache[key]
    }
  }
  const runtime = require(join(repo, 'src/lib/db-runtime.js'))
  t.after(async () => {
    try {
      runtime.prisma.$disconnect?.()
    } catch {}
    await rm(dir, { recursive: true, force: true })
  })
  return runtime
}

test('DateTime columns come back as Date objects for every model', async (t) => {
  const { prisma } = await freshRuntime(t, 'dates')

  const user = await prisma.user.create({
    data: { email: 'dates@x.i', username: 'dates', name: 'Dates', passwordHash: 'h' },
  })

  // Finding #2: these were raw strings, so `.getTime()` threw and /api/presence
  // answered 500.
  for (const field of ['createdAt', 'updatedAt', 'lastSeenAt']) {
    assert.ok(user[field] instanceof Date, `user.${field} must be a Date`)
    assert.ok(!Number.isNaN(user[field].getTime()), `user.${field} must be a valid date`)
  }

  const reloaded = await prisma.user.findUnique({ where: { id: user.id } })
  assert.ok(reloaded.lastSeenAt instanceof Date)
  assert.ok(Date.now() - reloaded.lastSeenAt.getTime() < 60_000)

  // A nullable DateTime stays null rather than becoming an Invalid Date.
  const session = await prisma.session.create({
    data: {
      userId: user.id,
      token: 'a'.repeat(64),
      sessionToken: 'a'.repeat(64),
      expiresAt: new Date(Date.now() + 60_000),
    },
  })
  assert.equal(session.deviceName, null)
  assert.ok(session.expiresAt instanceof Date)
})

test('Boolean columns come back as booleans, not 0/1', async (t) => {
  const { prisma } = await freshRuntime(t, 'bools')
  const user = await prisma.user.create({
    data: { email: 'bools@x.i', username: 'bools', name: 'B', passwordHash: 'h' },
  })
  assert.equal(typeof user.emailVerified, 'boolean')
  assert.equal(user.emailVerified, false)
  assert.equal(typeof user.twoFactorEnabled, 'boolean')

  await prisma.user.update({ where: { id: user.id }, data: { emailVerified: true } })
  const reloaded = await prisma.user.findUnique({ where: { id: user.id } })
  assert.equal(reloaded.emailVerified, true)
})

test('$transaction commits every write or none of them', async (t) => {
  const { prisma } = await freshRuntime(t, 'tx')
  const user = await prisma.user.create({
    data: { email: 'tx@x.i', username: 'tx', name: 'T', passwordHash: 'h' },
  })

  // Finding #7: `$transaction` did not exist, so polls could not be created.
  const result = await prisma.$transaction(async (tx) => {
    const message = await tx.message.create({
      data: { senderId: user.id, content: 'poll message', type: 'poll' },
    })
    const poll = await tx.poll.create({
      data: { messageId: message.id, question: 'Lunch?', options: '["yes","no"]' },
    })
    return { message, poll }
  })
  assert.ok(result.poll.id)

  const storedPoll = await prisma.poll.findUnique({ where: { id: result.poll.id } })
  assert.ok(storedPoll, 'the poll must be committed')
  assert.equal(storedPoll.question, 'Lunch?')

  // A throw rolls the whole thing back.
  await assert.rejects(
    prisma.$transaction(async (tx) => {
      await tx.message.create({ data: { senderId: user.id, content: 'should not persist' } })
      throw new Error('deliberate failure')
    }),
    /deliberate failure/,
  )
  assert.equal(
    await prisma.message.findFirst({ where: { content: 'should not persist' } }),
    null,
    'nothing may be committed when the callback throws',
  )

  // The array form works too.
  const [a, b] = await prisma.$transaction([
    prisma.message.create({ data: { senderId: user.id, content: 'array one' } }),
    prisma.message.create({ data: { senderId: user.id, content: 'array two' } }),
  ])
  assert.ok(a.id && b.id)
  assert.equal(await prisma.message.findFirst({ where: { content: 'array two' } }).then((m) => Boolean(m)), true)
})

test('groupBy and aggregate work for poll tallies', async (t) => {
  const { prisma } = await freshRuntime(t, 'agg')
  const user = await prisma.user.create({
    data: { email: 'agg@x.i', username: 'agg', name: 'A', passwordHash: 'h' },
  })
  const other = await prisma.user.create({
    data: { email: 'agg2@x.i', username: 'agg2', name: 'A2', passwordHash: 'h' },
  })
  const message = await prisma.message.create({
    data: { senderId: user.id, content: 'poll', type: 'poll' },
  })
  const poll = await prisma.poll.create({
    data: { messageId: message.id, question: 'Q', options: '["a","b"]' },
  })

  await prisma.pollVote.create({ data: { pollId: poll.id, userId: user.id, optionIdx: 0 } })
  await prisma.pollVote.create({ data: { pollId: poll.id, userId: other.id, optionIdx: 0 } })

  const grouped = await prisma.pollVote.groupBy({
    by: ['optionIdx'],
    where: { pollId: poll.id },
    _count: true,
  })
  assert.deepEqual(grouped, [{ optionIdx: 0, _count: 2 }])

  const total = await prisma.pollVote.aggregate({ where: { pollId: poll.id }, _count: true })
  assert.equal(total._count, 2)
})

test('include resolves to-one, to-many and nested relations', async (t) => {
  // This is the bug that made the socket handshake reject every session: the
  // generated relation map was never attached, so `include` silently returned
  // nothing and `findActiveSession` gave up on a valid session.
  const { prisma } = await freshRuntime(t, 'include')

  await prisma.user.create({
    data: { id: 'inc-alice', email: 'inc-a@x.i', username: 'inc-a', name: 'Alice', passwordHash: 'h' },
  })
  await prisma.user.create({
    data: { id: 'inc-bob', email: 'inc-b@x.i', username: 'inc-b', name: 'Bob', passwordHash: 'h' },
  })
  await prisma.profile.create({
    data: { userId: 'inc-alice', photoUrl: '/api/files/inc', profileVisibility: 'FRIENDS' },
  })
  const token = 'c'.repeat(64)
  await prisma.session.create({
    data: { userId: 'inc-alice', token, sessionToken: token, expiresAt: new Date(Date.now() + 60_000) },
  })
  const message = await prisma.message.create({
    data: { senderId: 'inc-alice', receiverId: 'inc-bob', content: 'hi', status: 'SENT' },
  })
  await prisma.messageReaction.create({ data: { messageId: message.id, userId: 'inc-bob', emoji: '👍' } })
  await prisma.group.create({ data: { id: 'inc-group', name: 'G', createdBy: 'inc-alice', ownerId: 'inc-alice' } })
  await prisma.groupMember.create({ data: { groupId: 'inc-group', userId: 'inc-alice', role: 'OWNER' } })

  const session = await prisma.session.findUnique({
    where: { token },
    include: { user: { include: { profile: true } } },
  })
  assert.ok(session?.user, 'session.user must be loaded')
  assert.equal(session.user.name, 'Alice')
  assert.ok(session.user.profile, 'nested include must load user.profile')
  assert.equal(session.user.profile.photoUrl, '/api/files/inc')

  const user = await prisma.user.findUnique({
    where: { id: 'inc-alice' },
    include: { profile: true, groupMemberships: true, sessions: true },
  })
  assert.ok(user.profile, 'one-to-one back reference must resolve')
  assert.equal(user.groupMemberships.length, 1, 'one-to-many must resolve')
  assert.equal(user.sessions.length, 1)

  const messages = await prisma.message.findMany({
    where: { receiverId: 'inc-bob' },
    include: {
      sender: { include: { profile: true } },
      reactions: { include: { user: { select: { id: true, name: true } } } },
    },
  })
  assert.equal(messages[0].sender.name, 'Alice')
  assert.equal(messages[0].reactions[0].user.name, 'Bob')
})

test('the runtime refuses to boot against a half-migrated database', async (t) => {
  // A missing column used to surface as a 500 on whichever route touched it.
  // It must fail at startup, with the missing columns named.
  const dir = await mkdtemp(join(tmpdir(), 'friendconnect-runtime-partial-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const dbFile = join(dir, 'partial.sqlite')

  const Database = require(join(repo, 'node_modules/better-sqlite3'))
  const seed = new Database(dbFile)
  seed.exec('CREATE TABLE "User" (id TEXT PRIMARY KEY, email TEXT)')
  seed.close()

  for (const key of Object.keys(require.cache)) {
    if (key.includes(`${repo}/src/lib/db-runtime.js`) || key.includes(`${repo}/src/lib/db-migrations.cjs`)) {
      delete require.cache[key]
    }
  }
  const previous = process.env.DATABASE_URL
  process.env.DATABASE_URL = `file:${dbFile}`
  t.after(() => {
    process.env.DATABASE_URL = previous
  })

  const fresh = require(join(repo, 'src/lib/db-runtime.js'))
  assert.throws(
    () => fresh.getSqlite(),
    (error) => {
      assert.match(error.message, /schema is incomplete/i)
      assert.match(error.message, /missing/i)
      return true
    },
  )
})

test('generated metadata covers every model in the canonical schema', async (t) => {
  const { MODELS, EXPECTED_COLUMNS } = require(join(repo, 'src/lib/schema-metadata.cjs'))
  const { readFileSync } = require('fs')

  const canonical = readFileSync(join(repo, 'prisma/schema.prisma'), 'utf8')
  const modelNames = [...canonical.matchAll(/^model\s+(\w+)\s*\{/gm)].map((m) => m[1])

  assert.equal(
    Object.keys(MODELS).length,
    modelNames.length,
    'the runtime must have a delegate for every canonical model',
  )
  for (const name of modelNames) {
    const key = name[0].toLowerCase() + name.slice(1)
    assert.ok(MODELS[key], `missing delegate for ${name}`)
    assert.ok(EXPECTED_COLUMNS[key], `missing column expectation for ${name}`)
    assert.ok(EXPECTED_COLUMNS[key].columns.length > 0, `${name} reports no columns`)
  }
})

test('nested writes create related rows atomically (conversations and groups depend on it)', async (t) => {
  const { prisma } = await freshRuntime(t, 'nested')

  const owner = await prisma.user.create({
    data: { email: 'nested-owner@x.i', username: 'nested-owner', name: 'Owner', passwordHash: 'h' },
  })
  const friend = await prisma.user.create({
    data: { email: 'nested-friend@x.i', username: 'nested-friend', name: 'Friend', passwordHash: 'h' },
  })

  // POST /api/conversations writes the conversation and its members in one call.
  // Before nested-write support this threw "table Conversation has no column
  // named members" and every conversation/group creation was a 500.
  const conversation = await prisma.conversation.create({
    data: {
      type: 'group',
      title: 'Nested',
      ownerId: owner.id,
      members: {
        create: [
          { userId: owner.id, role: 'owner' },
          { userId: friend.id, role: 'member' },
        ],
      },
    },
    include: { members: true },
  })
  const reloaded = await prisma.conversation.findUnique({ where: { id: conversation.id }, include: { members: true } })
  assert.equal(reloaded.members.length, 2, 'both members are persisted')
  assert.deepEqual(
    reloaded.members.map((member) => member.userId).sort(),
    [owner.id, friend.id].sort(),
  )
  assert.equal(reloaded.members.find((member) => member.userId === owner.id).role, 'owner')

  // connect links an existing row instead of creating one.
  const direct = await prisma.conversation.create({
    data: { type: 'direct', members: { connect: [{ userId: friend.id }] } },
  })
  const linked = await prisma.conversationMember.findMany({ where: { conversationId: direct.id } })
  assert.equal(linked.length, 1)
  assert.equal(linked[0].userId, friend.id)

  // A failing child rolls the parent back: the foreign key rejects the member,
  // and the conversation must not survive as an empty group.
  await assert.rejects(
    prisma.conversation.create({
      data: { type: 'group', title: 'Doomed', members: { create: [{ userId: 'not-a-user', role: 'member' }] } },
    }),
    /FOREIGN KEY constraint failed/,
  )
  assert.equal(await prisma.conversation.count({ where: { title: 'Doomed' } }), 0, 'parent is rolled back')

  // update({ data: { members: { connect } } }) adds a member to a live group.
  await prisma.conversation.update({
    where: { id: direct.id },
    data: { members: { connect: [{ userId: owner.id }] } },
  })
  assert.equal(await prisma.conversationMember.count({ where: { conversationId: direct.id } }), 2)

  // Unsupported operations fail loudly instead of silently dropping the write.
  await assert.rejects(
    prisma.conversation.create({ data: { type: 'group', members: { set: [] } } }),
    /Unsupported nested write/,
  )
})

test('$transaction replays nested creates with the ids the callback already saw', async (t) => {
  const { prisma } = await freshRuntime(t, 'nested-tx')

  const user = await prisma.user.create({
    data: { email: 'tx-nested@x.i', username: 'tx-nested', name: 'Tx', passwordHash: 'h' },
  })

  const staged = await prisma.$transaction(async (tx) => {
    const conversation = await tx.conversation.create({
      data: { type: 'group', title: 'In transaction', members: { create: [{ userId: user.id, role: 'owner' }] } },
    })
    return conversation
  })

  const members = await prisma.conversationMember.findMany({ where: { conversationId: staged.id } })
  assert.equal(members.length, 1, 'the nested member is committed')
  assert.equal(members[0].userId, user.id)
  assert.equal(members[0].role, 'owner')
  // The committed member must be the row the callback was handed, not a new one.
  assert.equal(members[0].id, staged.members[0].id)
})

test('create, update, upsert, and delete honor args.select without leaking sensitive fields', async (t) => {
  const { prisma } = await freshRuntime(t, 'select-mutations')

  const created = await prisma.user.create({
    data: {
      email: 'sel@x.i',
      username: 'seluser',
      name: 'Sel',
      passwordHash: 'secret-hash',
      twoFactorSecret: 'secret-totp',
    },
    select: { id: true, username: true, name: true },
  })
  assert.deepEqual(Object.keys(created).sort(), ['id', 'name', 'username'])
  assert.equal('passwordHash' in created, false)
  assert.equal('twoFactorSecret' in created, false)

  const updated = await prisma.user.update({
    where: { id: created.id },
    data: { name: 'Sel Updated' },
    select: { id: true, name: true },
  })
  assert.deepEqual(Object.keys(updated).sort(), ['id', 'name'])
  assert.equal(updated.name, 'Sel Updated')
  assert.equal('passwordHash' in updated, false)

  const upsertedExisting = await prisma.user.upsert({
    where: { id: created.id },
    update: { name: 'Sel Upserted' },
    create: { email: 'never@x.i', username: 'never', name: 'Never', passwordHash: 'x' },
    select: { id: true, name: true },
  })
  assert.deepEqual(Object.keys(upsertedExisting).sort(), ['id', 'name'])
  assert.equal(upsertedExisting.name, 'Sel Upserted')

  const upsertedNew = await prisma.user.upsert({
    where: { email: 'sel2@x.i' },
    update: { name: 'Nope' },
    create: { email: 'sel2@x.i', username: 'sel2', name: 'Sel2', passwordHash: 'secret-hash-2' },
    select: { id: true, username: true },
  })
  assert.deepEqual(Object.keys(upsertedNew).sort(), ['id', 'username'])
  assert.equal('passwordHash' in upsertedNew, false)

  const deleted = await prisma.user.delete({
    where: { id: upsertedNew.id },
    select: { id: true, username: true },
  })
  assert.deepEqual(Object.keys(deleted).sort(), ['id', 'username'])
  assert.equal('passwordHash' in deleted, false)
})
