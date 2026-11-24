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

async function canInteract(prisma, fromId, toId, permission) {
  if (!fromId || !toId || fromId === toId) return false
  // Preserve the built-in assistant flow; it has no ordinary friendship row.
  if (toId === 'jara-ai-system-001' || toId === 'jara') return true
  const blocked = await prisma.block.findFirst({
    where: { OR: [{ fromId, toId }, { fromId: toId, toId: fromId }] },
    select: { id: true },
  })
  if (blocked) return false
  const friendship = await prisma.friendship.findFirst({
    where: {
      status: 'ACCEPTED',
      OR: [{ requesterId: fromId, receiverId: toId }, { requesterId: toId, receiverId: fromId }],
    },
    select: { id: true },
  })
  if (friendship) return true
  const user = await prisma.user.findUnique({
    where: { id: toId },
    include: { profile: true },
  })
  return !!user && user.profile?.[permission] === 'PUBLIC'
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
  eventRateLimit,
}
