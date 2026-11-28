'use strict'

/**
 * Regression tests for the Stage A (audit findings 1, 6) authorization and
 * message-validation primitives in `src/lib/socket-security.cjs`.
 *
 * These are the rules the REST routes and the realtime server now share. Each
 * test drives the exported function against a stub Prisma, so it fails if the
 * rule regresses regardless of which transport calls it.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  isBlockedBetween,
  canSendInConversation,
  canReadConversation,
  normalizeMessageContent,
  MAX_MESSAGE_LENGTH,
  JARA_IDS,
} = require('../../src/lib/socket-security.cjs')

const A = 'user-a'
const B = 'user-b'
const C = 'user-c'

/**
 * Minimal Prisma stub exposing only what the functions under test query.
 * `blocks` are directional pairs; `friendships` carry a status.
 */
function fakePrisma({ blocks = [], friendships = [] } = {}) {
  return {
    block: {
      findFirst: async ({ where }) => {
        const pairs = where.OR || []
        const hit = blocks.find(([from, to]) =>
          pairs.some((p) => p.fromId === from && p.toId === to),
        )
        return hit ? { id: `block:${hit[0]}>${hit[1]}` } : null
      },
    },
    friendship: {
      findFirst: async ({ where }) => {
        const pairs = where.OR || []
        const directed = (p, f) =>
          (p.requesterId === f.requesterId && p.receiverId === f.receiverId) ||
          (p.requesterId === f.receiverId && p.receiverId === f.requesterId)
        const hit = friendships.find((f) => pairs.some((p) => directed(p, f)))
        return hit ? { id: 'friendship-1', status: hit.status } : null
      },
    },
  }
}

// --- Finding 1: a block stops new messages in an existing conversation --------

test('isBlockedBetween is symmetric and ignores self', async () => {
  const prisma = fakePrisma({ blocks: [[A, B]] })
  assert.equal(await isBlockedBetween(prisma, A, B), true)
  assert.equal(await isBlockedBetween(prisma, B, A), true, 'a block blocks both directions')
  assert.equal(await isBlockedBetween(prisma, A, C), false)
  assert.equal(await isBlockedBetween(prisma, A, A), false)
  assert.equal(await isBlockedBetween(prisma, null, B), false)
})

test('a legacy Friendship BLOCKED row counts as a block', async () => {
  const prisma = fakePrisma({
    friendships: [{ requesterId: B, receiverId: A, status: 'BLOCKED' }],
  })
  assert.equal(await isBlockedBetween(prisma, A, B), true)
})

test('an accepted friendship does not count as a block', async () => {
  const prisma = fakePrisma({
    friendships: [{ requesterId: A, receiverId: B, status: 'ACCEPTED' }],
  })
  assert.equal(await isBlockedBetween(prisma, A, B), false)
})

test('the blocked party cannot send into the shared conversation', async () => {
  const prisma = fakePrisma({ blocks: [[B, A]] })
  const fromA = await canSendInConversation(prisma, A, [A, B])
  const fromB = await canSendInConversation(prisma, B, [A, B])
  assert.equal(fromA.allowed, false)
  assert.equal(fromA.blockedPeerId, B)
  assert.equal(fromB.allowed, false)
  assert.equal(fromB.blockedPeerId, A)
})

test('an unblocked group conversation still accepts messages', async () => {
  const prisma = fakePrisma()
  const result = await canSendInConversation(prisma, A, [A, B, C])
  assert.deepEqual(result, { allowed: true, blockedPeerId: null })
})

test('a block with one member of a group stops the sender, not the whole group', async () => {
  const prisma = fakePrisma({ blocks: [[C, A]] })
  const result = await canSendInConversation(prisma, A, [A, B, C])
  assert.equal(result.allowed, false)
  assert.equal(result.blockedPeerId, C)
})

test('a thread with only the assistant has nobody to block the sender', async () => {
  const prisma = fakePrisma({ blocks: [[A, JARA_IDS.JARA_AI]] })
  const result = await canSendInConversation(prisma, A, [A, JARA_IDS.JARA_AI])
  assert.equal(result.allowed, true)
})

test('a conversation with no peers is not an authorization failure by itself', async () => {
  const prisma = fakePrisma()
  assert.equal((await canSendInConversation(prisma, A, [])).allowed, true)
  assert.equal((await canSendInConversation(prisma, null, [A])).allowed, false)
})

// --- Finding 1: a block hides the thread from both parties --------------------

test('a block hides the conversation from both parties', async () => {
  // Symmetric by design: see the rationale on canReadConversation. A thread
  // neither side may post to must not stay readable by one of them, and a
  // symmetric rule cannot be used to learn who blocked whom.
  const prisma = fakePrisma({ blocks: [[A, B]] })
  assert.equal((await canReadConversation(prisma, B, [A, B])).allowed, false)
  assert.equal((await canReadConversation(prisma, A, [A, B])).allowed, false)
})

test('unblocking restores read access without deleting anything', async () => {
  const blocked = fakePrisma({ blocks: [[A, B]] })
  const unblocked = fakePrisma()
  assert.equal((await canReadConversation(blocked, B, [A, B])).allowed, false)
  assert.equal((await canReadConversation(unblocked, B, [A, B])).allowed, true)
})

test('a third party in a group thread is unaffected by another pair\'s block', async () => {
  const prisma = fakePrisma({ blocks: [[A, B]] })
  assert.equal((await canReadConversation(prisma, C, [A, B, C])).allowed, true)
})

// --- Finding 6: one message-length policy ------------------------------------

test('message validation enforces the 10 000-character policy', () => {
  assert.deepEqual(normalizeMessageContent('hello'), { ok: true, content: 'hello' })
  assert.equal(MAX_MESSAGE_LENGTH, 10_000)
  assert.deepEqual(normalizeMessageContent('x'.repeat(10_000)).ok, true)
  assert.deepEqual(normalizeMessageContent('x'.repeat(10_001)), {
    ok: false,
    error: 'Message too long',
  })
  // A multi-megabyte body must be rejected, not truncated silently.
  assert.equal(normalizeMessageContent('x'.repeat(5_000_000)).ok, false)
})

test('message validation rejects empty, blank, and non-string bodies', () => {
  for (const bad of ['', '   ', '\n\t ', null, undefined, {}, [], true]) {
    const result = normalizeMessageContent(bad)
    assert.equal(result.ok, false, `expected ${JSON.stringify(bad)} to be rejected`)
  }
})

test('message validation tolerates a numeric body and preserves formatting', () => {
  assert.deepEqual(normalizeMessageContent(42), { ok: true, content: '42' })
  const multiline = 'line one\nline two\n  indented'
  assert.deepEqual(normalizeMessageContent(multiline), { ok: true, content: multiline })
})
