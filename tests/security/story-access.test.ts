/**
 * Audit finding 30: story views are recorded only after authorization.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { decideStoryView } from '../../src/lib/story-access'

const now = new Date('2026-11-28T12:00:00Z')
const future = new Date(now.getTime() + 3600_000)
const past = new Date(now.getTime() - 3600_000)
const base = {
  viewerId: 'viewer', storyOwnerId: 'owner', expiresAt: future, isHighlight: false,
  friendshipAccepted: true, blocked: false, now,
}

test('accepted, unblocked friend may view a live story and the view is recorded', () => {
  assert.deepEqual(decideStoryView(base), { allowed: true, record: true })
})

test('non-friend is denied and nothing is recorded', () => {
  assert.deepEqual(decideStoryView({ ...base, friendshipAccepted: false }), { allowed: false, record: false })
})

test('a block in either direction denies a friend', () => {
  assert.equal(decideStoryView({ ...base, blocked: true }).allowed, false)
})

test('an expired story is denied to a friend', () => {
  assert.equal(decideStoryView({ ...base, expiresAt: past }).allowed, false)
})

test('a highlight stays viewable after its expiry', () => {
  assert.equal(decideStoryView({ ...base, expiresAt: past, isHighlight: true }).allowed, true)
})

test('an expired story is denied even to its owner', () => {
  assert.equal(decideStoryView({ ...base, viewerId: 'owner', expiresAt: past, friendshipAccepted: false }).allowed, false)
})

test('the owner may open their own story but it is not counted as a view', () => {
  assert.deepEqual(
    decideStoryView({ ...base, viewerId: 'owner', friendshipAccepted: false }),
    { allowed: true, record: false },
  )
})

test('the route calls the decision function and checks friendship and blocks before recording', () => {
  const src = readFileSync(join(process.cwd(), 'src/app/api/stories/[id]/view/route.ts'), 'utf8')
  assert.match(src, /decideStoryView\(/)
  assert.match(src, /db\.friendship\.findFirst/)
  assert.match(src, /db\.block\.findFirst/)
  const decideIdx = src.indexOf('decideStoryView(')
  const upsertIdx = src.indexOf('db.storyView.upsert')
  assert.ok(decideIdx > 0 && upsertIdx > decideIdx, 'authorization must precede the write')
})
