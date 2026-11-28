'use strict'

/**
 * Remove expired login sessions (audit finding 26).
 *
 * An expired `Session` row can no longer authenticate: every HTTP and socket
 * check requires `expiresAt > now`. Deleting those rows is therefore safe and only
 * reclaims storage. Unexpired rows are never touched, and revocation still works
 * through the same rows.
 */

/**
 * @param {{ session: { deleteMany: Function } }} store Prisma-compatible client
 * @param {Date} [now]
 * @returns {Promise<number>} number of expired rows removed
 */
async function deleteExpiredSessions(store, now = new Date()) {
  const result = await store.session.deleteMany({ where: { expiresAt: { lt: now } } })
  return result && typeof result.count === 'number' ? result.count : 0
}

module.exports = { deleteExpiredSessions }
