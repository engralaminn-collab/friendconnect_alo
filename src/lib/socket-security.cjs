'use strict'

async function findActiveSession(prisma, token, now = Date.now()) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/i.test(token)) return null
  const session = await prisma.session.findUnique({
    where: { token },
    include: { user: { include: { profile: true } } },
  })
  if (!session || !session.user || !session.expiresAt || new Date(session.expiresAt).getTime() <= now) return null
  return session
}

function createHandshakeMiddleware(prisma) {
  return async (socket, next) => {
    try {
      const authToken = socket.handshake?.auth?.token
      const cookieToken = socket.handshake?.headers?.cookie
        ?.split(';').map((part) => part.trim()).find((part) => part.startsWith('fc_session='))
        ?.slice('fc_session='.length)
      const token = typeof authToken === 'string' && authToken ? authToken : cookieToken
      const session = await findActiveSession(prisma, token)
      if (!session) return next(new Error('unauthorized'))
      socket.data.authenticatedSessionToken = session.token
      socket.data.pendingUser = session.user
      return next()
    } catch {
      return next(new Error('unauthorized'))
    }
  }
}

async function isSessionActive(prisma, token, now = Date.now()) {
  try {
    return !!(await findActiveSession(prisma, token, now))
  } catch {
    return false
  }
}

async function isMessageParticipant(prisma, userId, message) {
  if (!message) return false
  if (message.groupId) {
    return !!(await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId: message.groupId, userId } },
      select: { id: true },
    }))
  }
  return message.senderId === userId || message.receiverId === userId
}

/**
 * Permission values accepted by `Profile.messagePermission` /
 * `Profile.callPermission`. `PUBLIC` is the legacy spelling of `EVERYONE` and is
 * still honoured so existing rows keep working.
 */
const OPEN_PERMISSIONS = new Set(['PUBLIC', 'EVERYONE'])

/**
 * May `fromId` interact with `toId`?
 *
 * This is the single authorization primitive for both REST and the socket
 * server — importing one implementation is what stops the two from drifting
 * (finding #3 asked for REST to enforce what the socket already enforced).
 *
 * Order matters: a block always wins, even over an existing friendship.
 *
 * @param {object} prisma
 * @param {string} fromId
 * @param {string} toId
 * @param {'messagePermission'|'callPermission'} permission
 * @returns {Promise<boolean>}
 */
async function canInteract(prisma, fromId, toId, permission) {
  if (!fromId || !toId || fromId === toId) return false
  // Preserve the built-in assistant flow; it has no ordinary friendship row.
  if (toId === JARA_IDS.JARA_AI || toId === JARA_IDS.JARA_ALIAS) return true

  const blocked = await prisma.block.findFirst({
    where: { OR: [{ fromId, toId }, { fromId: toId, toId: fromId }] },
    select: { id: true },
  })
  if (blocked) return false

  // One lookup covers both states. A BLOCKED friendship row can outlive the
  // Block row if data was written by an older release, so it must be treated as
  // a block; a single query keeps the two answers consistent.
  const relationship = await prisma.friendship.findFirst({
    where: {
      OR: [{ requesterId: fromId, receiverId: toId }, { requesterId: toId, receiverId: fromId }],
    },
    select: { id: true, status: true },
  })
  if (relationship?.status === 'BLOCKED') return false
  if (relationship?.status === 'ACCEPTED') return true

  // Not friends: the recipient's profile decides. Defaults are FRIENDS, so a
  // missing profile is a refusal, not an allow.
  const user = await prisma.user.findUnique({ where: { id: toId }, include: { profile: true } })
  if (!user) return false
  return OPEN_PERMISSIONS.has(String(user.profile?.[permission] || 'FRIENDS'))
}

/** May `userId` send a direct message to `toId`? */
function canMessage(prisma, fromId, toId) {
  return canInteract(prisma, fromId, toId, 'messagePermission')
}

/**
 * Is a one-directional block in force between two users?
 *
 * `canInteract` answers "may A start a conversation with B", which includes the
 * recipient's message permission. A block is a stronger, two-sided statement:
 * neither party may put new content into a thread they share, even though the
 * thread and its history stay readable. Blocking is checked here against the
 * `Block` table *and* a legacy `Friendship.status === 'BLOCKED'` row, for the
 * same reason `canInteract` checks both — an older release could leave one
 * without the other.
 *
 * @returns {Promise<boolean>}
 */
async function isBlockedBetween(prisma, a, b) {
  if (!a || !b) return false
  if (a === b) return false
  const block = await prisma.block.findFirst({
    where: { OR: [{ fromId: a, toId: b }, { fromId: b, toId: a }] },
    select: { id: true },
  })
  if (block) return true
  const relationship = await prisma.friendship.findFirst({
    where: {
      OR: [{ requesterId: a, receiverId: b }, { requesterId: b, receiverId: a }],
    },
    select: { id: true, status: true },
  })
  return relationship?.status === 'BLOCKED'
}

/**
 * May `senderId` create a new message in an existing conversation?
 *
 * Membership is necessary but not sufficient. `POST /api/blocks` removes the
 * `Friendship` row and leaves `ConversationMember` intact so history survives,
 * which means a member row can outlive the relationship that justified it. The
 * socket and REST paths both call this before writing a message; without it a
 * blocked user kept writing into the shared thread (audit finding 1).
 *
 * Blocking is the only rule applied here. Message permission is deliberately
 * *not* re-checked: it gates whether a conversation may be started, not whether
 * two people already talking may keep replying, and applying it mid-thread would
 * silently break conversations whenever a profile switched to FRIENDS-only.
 *
 * @param {object} prisma
 * @param {string} senderId
 * @param {string[]} peerIds every other participant of the conversation
 * @returns {Promise<{allowed: boolean, blockedPeerId: string|null}>}
 */
async function canSendInConversation(prisma, senderId, peerIds) {
  if (!senderId) return { allowed: false, blockedPeerId: null }
  const peers = Array.isArray(peerIds) ? peerIds.filter((id) => typeof id === 'string' && id && id !== senderId) : []
  // A conversation with no other human participant (e.g. a thread with the
  // assistant only) has nobody to block the sender.
  for (const peerId of peers) {
    if (isJaraId(peerId)) continue
    if (await isBlockedBetween(prisma, senderId, peerId)) {
      return { allowed: false, blockedPeerId: peerId }
    }
  }
  return { allowed: true, blockedPeerId: null }
}

/**
 * May `userId` read an existing conversation?
 *
 * Membership is necessary but not sufficient, for the same reason it is on the
 * write path: `POST /api/blocks` leaves `ConversationMember` rows in place so
 * history survives, which means a member row can outlive the relationship.
 *
 * A block hides the thread from **both** parties, not just the blocked one
 * (audit finding 1). This is a deliberate product decision, recorded here because
 * the alternative is also defensible:
 *
 *  - Hiding it symmetrically keeps a block a single fact rather than a fact plus a
 *    directional rule, so no response can reveal *who* blocked whom. It also means
 *    the other party cannot keep reading a thread the blocker has ended.
 *  - It matches the write rule, which is already symmetric: neither side can post.
 *    A thread nobody on either side may post to is not usefully half-visible.
 *  - Nothing is deleted. Unblocking restores the thread on both sides, because the
 *    rule is evaluated per request and no `ConversationMember` or `Message` row is
 *    removed.
 *
 * Direct threads between two already-blocked users can no longer be created at
 * all (see `POST /api/conversations`), so in practice this only affects threads
 * that predate the block.
 *
 * @returns {Promise<{allowed: boolean, blockedPeerId: string|null}>}
 */
async function canReadConversation(prisma, userId, peerIds) {
  if (!userId) return { allowed: false, blockedPeerId: null }
  const peers = Array.isArray(peerIds) ? peerIds.filter((id) => typeof id === 'string' && id && id !== userId) : []
  for (const peerId of peers) {
    if (isJaraId(peerId)) continue
    if (await isBlockedBetween(prisma, userId, peerId)) {
      return { allowed: false, blockedPeerId: peerId }
    }
  }
  return { allowed: true, blockedPeerId: null }
}

/** May `userId` call `toId`? */
function canCall(prisma, fromId, toId) {
  return canInteract(prisma, fromId, toId, 'callPermission')
}

/** Where else the assistant id is spelled; keep them in one place. */
const JARA_IDS = { JARA_AI: 'jara-ai-system-001', JARA_ALIAS: 'jara' }

function isJaraId(id) {
  return id === JARA_IDS.JARA_AI || id === JARA_IDS.JARA_ALIAS
}

function eventRateLimit(event) {
  if (event === 'message:send' || event === 'group:message:send') return { max: 30, windowSeconds: 60 }
  if (event.startsWith('call:')) return { max: 30, windowSeconds: 10 }
  if (event === 'reaction:add' || event === 'reaction:remove') return { max: 60, windowSeconds: 60 }
  if (event === 'message:seen' || event === 'typing' || event === 'group:typing') return { max: 120, windowSeconds: 60 }
  if (event === 'message:edit' || event === 'message:delete') return { max: 30, windowSeconds: 60 }
  return null
}

/** Maximum length of a message body, in characters. One policy for every path. */
const MAX_MESSAGE_LENGTH = 10_000

/**
 * Validate a message body for storage.
 *
 * The REST fallback in `POST /api/messages` previously accepted any length while
 * the socket and conversation routes capped at 10 000 characters (audit finding
 * 6), so a single request could store a multi-megabyte row that then broke list
 * responses and the AI context builder.
 *
 * @param {unknown} raw
 * @returns {{ok: true, content: string} | {ok: false, error: string}}
 */
function normalizeMessageContent(raw) {
  if (raw === null || raw === undefined) return { ok: false, error: 'Empty message' }
  if (typeof raw !== 'string' && typeof raw !== 'number') return { ok: false, error: 'Invalid message' }
  const content = String(raw)
  if (content.length > MAX_MESSAGE_LENGTH) return { ok: false, error: 'Message too long' }
  if (!content.trim()) return { ok: false, error: 'Empty message' }
  return { ok: true, content }
}

module.exports = {
  findActiveSession,
  createHandshakeMiddleware,
  isSessionActive,
  isMessageParticipant,
  canInteract,
  canMessage,
  canCall,
  isBlockedBetween,
  canSendInConversation,
  canReadConversation,
  normalizeMessageContent,
  MAX_MESSAGE_LENGTH,
  isJaraId,
  JARA_IDS,
  eventRateLimit,
}
