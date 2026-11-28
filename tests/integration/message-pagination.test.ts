/**
 * Audit finding 20: cursor pagination, ordering, and concurrent insertion on the
 * real SQLite runtime. Messages are created in bulk with identical timestamps, which
 * is the case a non-unique sort key gets wrong.
 */
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { openTempDatabase } from '../support/temp-db'

const temp = openTempDatabase('pagination')
let db: any
let fetchMessagePage: any

before(async () => {
  db = (await import('../../src/lib/db')).db
  ;({ fetchMessagePage } = await import('../../src/lib/message-page'))
})
after(() => temp.cleanup())

async function setup(label: string) {
  const a = await db.user.create({ data: { email: `${label}a@pg.test`, username: `${label}a`, name: 'A', passwordHash: 'x' } })
  const b = await db.user.create({ data: { email: `${label}b@pg.test`, username: `${label}b`, name: 'B', passwordHash: 'x' } })
  const conv = await db.conversation.create({ data: { type: 'DIRECT' } })
  await db.conversationMember.create({ data: { conversationId: conv.id, userId: a.id } })
  await db.conversationMember.create({ data: { conversationId: conv.id, userId: b.id } })
  return { a, b, conv }
}

async function collectAll(conversationId: string, limit: number) {
  const seen: string[] = []
  let cursor: string | null = null
  for (let guard = 0; guard < 1000; guard++) {
    const { page, hasMore, nextCursor } = await fetchMessagePage(db, { conversationId, cursor, limit })
    seen.push(...page.map((m: any) => m.id))
    if (!hasMore) break
    cursor = nextCursor
  }
  return seen
}

test('paging with identical timestamps returns every message exactly once', async () => {
  const { a, conv } = await setup('same')
  const stamp = new Date('2026-11-28T10:00:00.000Z')
  const created: string[] = []
  for (let i = 0; i < 23; i++) {
    const m = await db.message.create({
      data: { conversationId: conv.id, senderId: a.id, content: `m${i}`, createdAt: stamp },
    })
    created.push(m.id)
  }
  const seen = await collectAll(conv.id, 4)
  assert.equal(seen.length, created.length, `expected ${created.length} rows, got ${seen.length}`)
  assert.equal(new Set(seen).size, seen.length, 'no row may appear on two pages')
  assert.deepEqual([...seen].sort(), [...created].sort(), 'no row may be skipped')
})

test('pages are ordered newest first and a page boundary never reverses order', async () => {
  const { a, conv } = await setup('order')
  for (let i = 0; i < 9; i++) {
    await db.message.create({
      data: { conversationId: conv.id, senderId: a.id, content: `o${i}`, createdAt: new Date(Date.UTC(2026, 10, 28, 10, 0, i)) },
    })
  }
  const first = await fetchMessagePage(db, { conversationId: conv.id, limit: 4 })
  assert.equal(first.hasMore, true)
  assert.equal(first.page.length, 4)
  const times = first.page.map((m: any) => new Date(m.createdAt).getTime())
  assert.deepEqual([...times].sort((x, y) => y - x), times, 'newest first within a page')
  const second = await fetchMessagePage(db, { conversationId: conv.id, cursor: first.nextCursor, limit: 4 })
  const lastOfFirst = new Date(first.page[3].createdAt).getTime()
  const firstOfSecond = new Date(second.page[0].createdAt).getTime()
  assert.ok(firstOfSecond <= lastOfFirst, 'the next page continues older than the previous one')
})

test('the final page reports no next cursor', async () => {
  const { a, conv } = await setup('end')
  await db.message.create({ data: { conversationId: conv.id, senderId: a.id, content: 'only' } })
  const r = await fetchMessagePage(db, { conversationId: conv.id, limit: 5 })
  assert.equal(r.hasMore, false)
  assert.equal(r.nextCursor, null)
  assert.equal(r.page.length, 1)
})

test('messages inserted while a client is paging are not duplicated on later pages', async () => {
  const { a, conv } = await setup('live')
  for (let i = 0; i < 10; i++) {
    await db.message.create({ data: { conversationId: conv.id, senderId: a.id, content: `l${i}`, createdAt: new Date('2026-11-28T11:00:00.000Z') } })
  }
  const first = await fetchMessagePage(db, { conversationId: conv.id, limit: 4 })
  // Concurrent inserts land while the client holds a cursor. Newer rows do not
  // belong to the older pages the client is walking.
  await Promise.all([1, 2, 3].map((i) =>
    db.message.create({ data: { conversationId: conv.id, senderId: a.id, content: `new${i}`, createdAt: new Date('2026-11-28T12:00:00.000Z') } }),
  ))
  const rest: string[] = []
  let cursor = first.nextCursor
  let hasMore = first.hasMore
  while (hasMore) {
    const r = await fetchMessagePage(db, { conversationId: conv.id, cursor, limit: 4 })
    rest.push(...r.page.map((m: any) => m.id))
    hasMore = r.hasMore
    cursor = r.nextCursor
  }
  const firstIds = first.page.map((m: any) => m.id)
  const all = [...firstIds, ...rest]
  assert.equal(new Set(all).size, all.length, 'no duplicates across pages after concurrent inserts')
})

test('a cursor naming a missing message ends the walk instead of restarting it', async () => {
  const { a, conv } = await setup('stale')
  for (let i = 0; i < 5; i++) {
    await db.message.create({ data: { conversationId: conv.id, senderId: a.id, content: `s${i}` } })
  }
  const r = await fetchMessagePage(db, { conversationId: conv.id, cursor: 'does-not-exist', limit: 2 })
  assert.deepEqual(r.page, [])
  assert.equal(r.hasMore, false)
  assert.equal(r.nextCursor, null)
})

test('the SQLite runtime does not treat a cursor as an offset (regression for the fixed-OFFSET loop)', async () => {
  const { a, conv } = await setup('regress')
  const stamp = new Date('2026-11-28T13:00:00.000Z')
  for (let i = 0; i < 12; i++) {
    await db.message.create({ data: { conversationId: conv.id, senderId: a.id, content: `r${i}`, createdAt: stamp } })
  }
  const first = await fetchMessagePage(db, { conversationId: conv.id, limit: 3 })
  const second = await fetchMessagePage(db, { conversationId: conv.id, cursor: first.nextCursor, limit: 3 })
  const overlap = second.page.filter((m: any) => first.page.some((f: any) => f.id === m.id))
  assert.equal(overlap.length, 0, 'the second page must not repeat rows from the first')
})
