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

module.exports = {
  findActiveSession,
  createHandshakeMiddleware,
  isSessionActive,
  isMessageParticipant,
  canInteract,
  canMessage,
  canCall,
  isJaraId,
  JARA_IDS,
  eventRateLimit,
}
