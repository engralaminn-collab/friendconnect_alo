'use strict'

/**
 * Audit finding 26 (stories): the retention sweep on the real db-runtime.
 * Covers the boundary, the highlight exemption, cascades to views, and the
 * STORY_RETENTION_DAYS parsing.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdtemp, rm } = require('fs/promises')
const { tmpdir } = require('os')
const { join, resolve } = require('path')

const repo = resolve(__dirname, '../..')
const DAY = 24 * 60 * 60 * 1000

test('expired stories past the retention window are removed; the rest survive', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'friendconnect-story-sweep-'))
  process.env.DATABASE_URL = `file:${join(dir, 'stories.sqlite')}`
  for (const key of Object.keys(require.cache)) {
    if (key.includes(`${repo}/src/lib/db-runtime.js`) || key.includes(`${repo}/src/lib/db-migrations.cjs`)) delete require.cache[key]
  }
  const { prisma } = require(join(repo, 'src/lib/db-runtime.js'))
  t.after(async () => { try { prisma.$disconnect?.() } catch {} ; await rm(dir, { recursive: true, force: true }) })
  const { deleteExpiredStories, resolveRetentionDays } = require(join(repo, 'src/lib/story-sweep.cjs'))

  const owner = await prisma.user.create({ data: { email: 'st-owner@x.i', username: 'stowner', name: 'O', passwordHash: 'h' } })
  const viewer = await prisma.user.create({ data: { email: 'st-viewer@x.i', username: 'stviewer', name: 'V', passwordHash: 'h' } })
  const now = new Date('2026-11-28T12:00:00Z')
  const story = (expiresAt, isHighlight = false) => prisma.story.create({
    data: { userId: owner.id, type: 'text', content: 'c', expiresAt, isHighlight },
  })
  const oldExpired = await story(new Date(now.getTime() - 10 * DAY))
  const recentExpired = await story(new Date(now.getTime() - 1 * DAY))
  const oldHighlight = await story(new Date(now.getTime() - 30 * DAY), true)
  const live = await story(new Date(now.getTime() + DAY))

  await prisma.storyView.create({ data: { storyId: oldExpired.id, userId: viewer.id } })

  assert.equal(await deleteExpiredStories(prisma, now, 7), 1, 'only the old, non-highlight story is removed')
  assert.equal(await prisma.story.findUnique({ where: { id: oldExpired.id } }), null)
  assert.equal(await prisma.storyView.count({ where: { storyId: oldExpired.id } }), 0, 'its views go with it')
  assert.ok(await prisma.story.findUnique({ where: { id: recentExpired.id } }), 'inside the retention window: kept')
  assert.ok(await prisma.story.findUnique({ where: { id: oldHighlight.id } }), 'highlights are kept regardless of age')
  assert.ok(await prisma.story.findUnique({ where: { id: live.id } }), 'a live story is kept')
  assert.equal(await deleteExpiredStories(prisma, now, 7), 0, 'a second pass is a no-op')
})

test('retention days: defaults to 7 for unset or invalid values, accepts a valid override', () => {
  const { resolveRetentionDays, DEFAULT_RETENTION_DAYS } = require(join(repo, 'src/lib/story-sweep.cjs'))
  assert.equal(DEFAULT_RETENTION_DAYS, 7)
  assert.equal(resolveRetentionDays(undefined), 7)
  assert.equal(resolveRetentionDays(''), 7)
  assert.equal(resolveRetentionDays('abc'), 7)
  assert.equal(resolveRetentionDays('-3'), 7, 'a negative window would delete live stories')
  assert.equal(resolveRetentionDays('30'), 30)
  assert.equal(resolveRetentionDays('0'), 0)
})
