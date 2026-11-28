/**
 * Audit finding 18: direct tests of the friendship state machine.
 *
 * These run `applyFriendAction` (src/lib/friendship.ts) against a real SQLite file,
 * so every transition is checked against stored rows, not against a mock.
 */
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { openTempDatabase } from '../support/temp-db'

const temp = openTempDatabase('friendship')
let db: any
let applyFriendAction: any
let isBlockedBetween: any
let findRelationship: any

let counter = 0
async function makeUser(label: string) {
  counter += 1
  return db.user.create({
    data: {
      email: `${label}${counter}@fs.test`,
      username: `${label}${counter}`,
      name: label,
      passwordHash: 'x',
    },
  })
}

async function rowsBetween(a: string, b: string) {
  return db.friendship.findMany({
    where: {
      OR: [
        { requesterId: a, receiverId: b },
        { requesterId: b, receiverId: a },
      ],
    },
  })
}

before(async () => {
  const mod = await import('../../src/lib/friendship')
  applyFriendAction = mod.applyFriendAction
  isBlockedBetween = mod.isBlockedBetween
  findRelationship = mod.findRelationship
  db = (await import('../../src/lib/db')).db
})

after(() => temp.cleanup())

test('request creates one PENDING row and a repeat request is idempotent', async () => {
  const a = await makeUser('req')
  const b = await makeUser('reqb')
  const first = await applyFriendAction(a.id, b.id, 'request')
  assert.equal(first.status, 'PENDING')
  assert.equal(first.changed, true)
  const second = await applyFriendAction(a.id, b.id, 'request')
  assert.equal(second.changed, false)
  assert.equal((await rowsBetween(a.id, b.id)).length, 1)
})

test('only the recipient can accept; a non-recipient is refused and the row is unchanged', async () => {
  const a = await makeUser('acc')
  const b = await makeUser('accb')
  await applyFriendAction(a.id, b.id, 'request')
  await assert.rejects(applyFriendAction(a.id, b.id, 'accept'), { code: 'NOT_RECIPIENT', status: 403 })
  assert.equal((await findRelationship(a.id, b.id)).status, 'PENDING')
  const accepted = await applyFriendAction(b.id, a.id, 'accept')
  assert.equal(accepted.status, 'ACCEPTED')
  assert.equal(accepted.changed, true)
  assert.equal((await applyFriendAction(b.id, a.id, 'accept')).changed, false, 'accepting twice is idempotent')
})

test('accept with no request is 404 NO_REQUEST', async () => {
  const a = await makeUser('nor')
  const b = await makeUser('norb')
  await assert.rejects(applyFriendAction(a.id, b.id, 'accept'), { code: 'NO_REQUEST', status: 404 })
})

test('reciprocal request while pending accepts the existing request', async () => {
  const a = await makeUser('recip')
  const b = await makeUser('recipb')
  await applyFriendAction(a.id, b.id, 'request')
  const result = await applyFriendAction(b.id, a.id, 'request')
  assert.equal(result.status, 'ACCEPTED')
  assert.equal((await rowsBetween(a.id, b.id)).length, 1)
})

test('recipient declines (REJECTED); requester cannot decline; a new request revives the row', async () => {
  const a = await makeUser('rej')
  const b = await makeUser('rejb')
  await applyFriendAction(a.id, b.id, 'request')
  await assert.rejects(applyFriendAction(a.id, b.id, 'reject'), { code: 'NOT_RECIPIENT' })
  const rejected = await applyFriendAction(b.id, a.id, 'reject')
  assert.equal(rejected.status, 'REJECTED')
  const revived = await applyFriendAction(a.id, b.id, 'request')
  assert.equal(revived.status, 'PENDING')
  assert.equal((await rowsBetween(a.id, b.id)).length, 1, 'a rejected pair keeps a single row')
})

test('requester cancels a pending request and the row is removed; the recipient cannot cancel', async () => {
  const a = await makeUser('can')
  const b = await makeUser('canb')
  await applyFriendAction(a.id, b.id, 'request')
  await assert.rejects(applyFriendAction(b.id, a.id, 'cancel'), { code: 'NOT_SENDER' })
  const cancelled = await applyFriendAction(a.id, b.id, 'cancel')
  assert.equal(cancelled.status, 'NONE')
  assert.equal((await rowsBetween(a.id, b.id)).length, 0)
})

test('remove deletes an accepted friendship', async () => {
  const a = await makeUser('rem')
  const b = await makeUser('remb')
  await applyFriendAction(a.id, b.id, 'request')
  await applyFriendAction(b.id, a.id, 'accept')
  const removed = await applyFriendAction(a.id, b.id, 'remove')
  assert.equal(removed.status, 'NONE')
  assert.equal((await rowsBetween(a.id, b.id)).length, 0)
})

test('a blocked pair cannot send requests, and remove is refused until unblock', async () => {
  const a = await makeUser('blk')
  const b = await makeUser('blkb')
  await applyFriendAction(a.id, b.id, 'request')
  await applyFriendAction(b.id, a.id, 'accept')
  const blocked = await applyFriendAction(a.id, b.id, 'block')
  assert.equal(blocked.status, 'BLOCKED')
  assert.equal(await isBlockedBetween(a.id, b.id), true)
  await assert.rejects(applyFriendAction(b.id, a.id, 'request'), { code: 'BLOCKED', status: 403 })
  await assert.rejects(applyFriendAction(a.id, b.id, 'remove'), { code: 'BLOCKED', status: 409 })
})

test('the blocker can unblock, which returns the pair to no relationship', async () => {
  const a = await makeUser('ub')
  const b = await makeUser('ubb')
  await applyFriendAction(a.id, b.id, 'block')
  const unblocked = await applyFriendAction(a.id, b.id, 'unblock')
  assert.equal(unblocked.status, 'NONE')
  assert.equal(await isBlockedBetween(a.id, b.id), false)
})

test('a user who was blocked by someone else cannot erase that block by calling unblock', async () => {
  const blocker = await makeUser('bly')
  const victim = await makeUser('vic')
  await applyFriendAction(blocker.id, victim.id, 'block')
  // The victim calls unblock. Only the blocker may lift the block.
  await applyFriendAction(victim.id, blocker.id, 'unblock')
  assert.equal(await isBlockedBetween(victim.id, blocker.id), true, 'the block must survive')
  const rel = await findRelationship(victim.id, blocker.id)
  assert.ok(rel, 'the BLOCKED relationship row must not be deleted by the victim')
  assert.equal(rel.status, 'BLOCKED')
  assert.equal(rel.blockerId, blocker.id)
})

test('a user cannot target themselves and an unknown user is 404', async () => {
  const a = await makeUser('self')
  await assert.rejects(applyFriendAction(a.id, a.id, 'request'), { code: 'SELF_TARGET' })
  await assert.rejects(applyFriendAction(a.id, 'no-such-user', 'request'), { code: 'USER_NOT_FOUND', status: 404 })
})

test('simultaneous opposite requests leave exactly one relationship row', async () => {
  const a = await makeUser('race')
  const b = await makeUser('raceb')
  await Promise.all([
    applyFriendAction(a.id, b.id, 'request'),
    applyFriendAction(b.id, a.id, 'request'),
  ]).catch(() => null)
  const rows = await rowsBetween(a.id, b.id)
  assert.equal(rows.length, 1, `expected one row, found ${rows.length}`)
})
