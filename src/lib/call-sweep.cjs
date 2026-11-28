'use strict'

/**
 * Expire calls that have rung without an answer (audit finding 29).
 *
 * A row is created with status `ringing` and, before this change, nothing ever
 * moved it out of that state if the callee never answered and the caller never
 * cancelled (for example, the caller closed the tab). Because the start-call
 * route and the socket invite both refuse a user who has a `ringing` or
 * `connected` call, a single stale row blocked that user from calling anyone.
 *
 * The sweep only touches rows that are still `ringing` and older than the
 * timeout. The update is conditional on `status: 'ringing'`, so an answer that
 * lands between the read and the write wins and the call is not marked missed.
 */

const DEFAULT_RING_TIMEOUT_SECONDS = 60

function ringTimeoutMs(env = process.env) {
  const raw = Number(env.CALL_RING_TIMEOUT_SECONDS)
  const seconds = Number.isFinite(raw) && raw >= 10 && raw <= 600 ? raw : DEFAULT_RING_TIMEOUT_SECONDS
  return seconds * 1000
}

/**
 * @param {{ call: { findMany: Function, updateMany: Function } }} store Prisma-compatible client
 * @param {{ now?: Date, timeoutMs?: number, limit?: number }} [options]
 * @returns {Promise<Array<{ id: string, callerId: string, receiverId: string }>>} calls moved to `missed`
 */
async function expireStaleRingingCalls(store, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date()
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : ringTimeoutMs()
  const cutoff = new Date(now.getTime() - timeoutMs)

  const stale = await store.call.findMany({
    where: { status: 'ringing', createdAt: { lt: cutoff } },
    select: { id: true, callerId: true, receiverId: true },
    take: options.limit || 100,
  })
  if (!stale.length) return []

  const expired = []
  for (const call of stale) {
    const result = await store.call.updateMany({
      where: { id: call.id, status: 'ringing' },
      data: { status: 'missed', endedAt: now },
    })
    if (result && result.count === 1) expired.push(call)
  }
  return expired
}

module.exports = { expireStaleRingingCalls, ringTimeoutMs, DEFAULT_RING_TIMEOUT_SECONDS }
