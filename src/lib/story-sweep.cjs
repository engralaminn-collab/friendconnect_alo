'use strict'

/**
 * Remove stories that have been expired for longer than the retention window
 * (audit finding 26).
 *
 * An expired story is already unviewable (story-access.ts denies it), so its rows
 * only occupy storage. The window keeps recently expired stories for owner review.
 * Highlights are never removed here: they are kept on purpose, regardless of expiry.
 * Views, replies and reactions go with the story through the schema's cascades
 * (foreign keys are enforced by db-runtime).
 */

const DAY_MS = 24 * 60 * 60 * 1000
const DEFAULT_RETENTION_DAYS = 7

/**
 * @param {string | undefined} raw  value of STORY_RETENTION_DAYS
 * @returns {number} a finite, non-negative number of days
 */
function resolveRetentionDays(raw) {
  const n = Number(raw)
  if (raw === undefined || raw === '' || !Number.isFinite(n) || n < 0) return DEFAULT_RETENTION_DAYS
  return n
}

/**
 * @param {{ story: { deleteMany: Function } }} store Prisma-compatible client
 * @param {Date} [now]
 * @param {number} [retentionDays]
 * @returns {Promise<number>} number of stories removed
 */
async function deleteExpiredStories(store, now = new Date(), retentionDays = DEFAULT_RETENTION_DAYS) {
  const cutoff = new Date(now.getTime() - retentionDays * DAY_MS)
  const result = await store.story.deleteMany({ where: { isHighlight: false, expiresAt: { lt: cutoff } } })
  return result && typeof result.count === 'number' ? result.count : 0
}

module.exports = { deleteExpiredStories, resolveRetentionDays, DEFAULT_RETENTION_DAYS }
