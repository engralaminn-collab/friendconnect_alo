import { createServer } from 'http'
import { Server } from 'socket.io'
// Import PrismaClient from the main project (where prisma generate produced the client)
import { PrismaClient } from '/home/z/my-project/node_modules/@prisma/client'

const db = new PrismaClient()

const httpServer = createServer()
const io = new Server(httpServer, {
  path: '/',
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000,
})

interface AuthPayload {
  token: string
}
interface SendMsgPayload {
  tempId?: string
  receiverId: string
  content: string
  type?: string
  fileUrl?: string
  fileName?: string
  fileSize?: number
  mimeType?: string
}
interface GroupSendPayload {
  tempId?: string
  groupId: string
  content: string
  type?: string
  fileUrl?: string
  fileName?: string
  fileSize?: number
  mimeType?: string
}

const online = new Map<string, Set<string>>() // userId -> set(socketIds)

function room(userId: string) {
  return `user:${userId}`
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const idx = part.indexOf('=')
    if (idx === -1) continue
    const k = part.slice(0, idx).trim()
    const v = part.slice(idx + 1).trim()
    out[k] = decodeURIComponent(v)
  }
  return out
}

io.use(async (socket, next) => {
  try {
    const cookies = parseCookies(socket.handshake.headers.cookie)
    const token = cookies['fc_session']
    if (!token) {
      socket.data.userId = null
      return next()
    }
    const session = await db.session.findUnique({
      where: { token },
      include: { user: true },
    })
    if (!session || session.expiresAt.getTime() < Date.now()) {
      socket.data.userId = null
      return next()
    }
    socket.data.userId = session.user.id
    socket.data.user = session.user
    next()
  } catch (e: any) {
    next(e)
  }
})

function setOnline(userId: string, socketId: string) {
  let set = online.get(userId)
  if (!set) {
    set = new Set()
    online.set(userId, set)
  }
  set.add(socketId)
}

function setOffline(userId: string, socketId: string) {
  const set = online.get(userId)
  if (!set) return
  set.delete(socketId)
  if (set.size === 0) online.delete(userId)
}

function isOnline(userId: string) {
  return online.has(userId)
}

async function updateLastSeen(userId: string) {
  try {
    await db.profile.update({
      where: { userId },
      data: { lastSeen: new Date() },
    })
  } catch {
    // profile may not exist yet
  }
}

io.on('connection', (socket) => {
  let userId: string | null = socket.data.userId ?? null

  const finishAuth = () => {
    if (!userId) return
    setOnline(userId, socket.id)
    socket.join(room(userId))
    io.emit('presence', { userId, online: true })
  }

  if (userId) finishAuth()

  // Fallback: client may also send token explicitly (e.g. if cookie not propagated)
  socket.on('auth', async (payload: AuthPayload, ack?: (r: any) => void) => {
    try {
      if (userId) {
        ack?.({ ok: true, userId })
        return
      }
      if (!payload?.token) {
        ack?.({ ok: false, error: 'no token' })
        return
      }
      const session = await db.session.findUnique({
        where: { token: payload.token },
        include: { user: true },
      })
      if (!session || session.expiresAt.getTime() < Date.now()) {
        ack?.({ ok: false, error: 'invalid session' })
        return
      }
      userId = session.user.id
      finishAuth()
      ack?.({ ok: true, userId })
    } catch (e: any) {
      ack?.({ ok: false, error: e?.message || 'error' })
    }
  })

  socket.on('message:send', async (data: SendMsgPayload, ack?: (r: any) => void) => {
    if (!userId) return ack?.({ ok: false, error: 'unauth' })
    try {
      const blocked = await db.friendship.findFirst({
        where: {
          status: 'BLOCKED',
          OR: [
            { requesterId: userId, receiverId: data.receiverId },
            { requesterId: data.receiverId, receiverId: userId },
          ],
        },
      })
      if (blocked) {
        ack?.({ ok: false, error: 'blocked' })
        return
      }
      const msg = await db.message.create({
        data: {
          senderId: userId,
          receiverId: data.receiverId,
          content: data.content,
          type: data.type || 'text',
          fileUrl: data.fileUrl,
          fileName: data.fileName,
          fileSize: data.fileSize,
          mimeType: data.mimeType,
          status: 'SENT',
        },
      })
      ack?.({ ok: true, message: msg, tempId: data.tempId })
      io.to(room(data.receiverId)).emit('message:new', msg)
      io.to(room(userId)).emit('message:new', msg)
      // if recipient online -> delivered
      if (isOnline(data.receiverId)) {
        await db.message.update({ where: { id: msg.id }, data: { status: 'DELIVERED' } }).catch(() => {})
        io.to(room(userId)).emit('message:status', { id: msg.id, status: 'DELIVERED' })
      }
    } catch (e: any) {
      ack?.({ ok: false, error: e?.message })
    }
  })

  socket.on('message:seen', async (data: { messageId: string }) => {
    if (!userId) return
    try {
      const msg = await db.message.findUnique({ where: { id: data.messageId } })
      if (!msg || msg.receiverId !== userId) return
      if (msg.status !== 'SEEN') {
        await db.message.update({
          where: { id: msg.id },
          data: { status: 'SEEN', seenAt: new Date() },
        })
      }
      io.to(room(msg.senderId)).emit('message:status', { id: msg.id, status: 'SEEN' })
    } catch {}
  })

  socket.on('typing', (data: { receiverId: string; isTyping: boolean }) => {
    if (!userId) return
    io.to(room(data.receiverId)).emit('typing:indicator', { userId, isTyping: data.isTyping })
  })

  // ---------- Reactions ----------
  socket.on('reaction:add', async (data: { messageId: string; emoji: string }, ack?: (r: any) => void) => {
    if (!userId) return ack?.({ ok: false, error: 'unauth' })
    try {
      const msg = await db.message.findUnique({ where: { id: data.messageId } })
      if (!msg) return ack?.({ ok: false, error: 'message not found' })
      // validate participation: sender, receiver, or group member
      const isParticipant =
        msg.senderId === userId ||
        msg.receiverId === userId ||
        (msg.groupId ? !!(await db.groupMember.findUnique({ where: { groupId_userId: { groupId: msg.groupId, userId } } })) : false)
      if (!isParticipant) return ack?.({ ok: false, error: 'forbidden' })
      const emoji = String(data.emoji || '').slice(0, 8)
      if (!emoji) return ack?.({ ok: false, error: 'no emoji' })
      await db.messageReaction.upsert({
        where: { messageId_userId_emoji: { messageId: data.messageId, userId, emoji } },
        update: {},
        create: { messageId: data.messageId, userId, emoji },
      })
      ack?.({ ok: true })
      const payload = { messageId: data.messageId, userId, emoji, action: 'add' as const }
      // notify sender + receiver (or group members)
      io.to(room(msg.senderId)).emit('reaction:update', payload)
      if (msg.receiverId) io.to(room(msg.receiverId)).emit('reaction:update', payload)
      if (msg.groupId) {
        const members = await db.groupMember.findMany({ where: { groupId: msg.groupId } })
        for (const m of members) io.to(room(m.userId)).emit('reaction:update', payload)
      }
    } catch (e: any) {
      ack?.({ ok: false, error: e?.message })
    }
  })

  socket.on('reaction:remove', async (data: { messageId: string; emoji: string }, ack?: (r: any) => void) => {
    if (!userId) return ack?.({ ok: false, error: 'unauth' })
    try {
      const msg = await db.message.findUnique({ where: { id: data.messageId } })
      if (!msg) return ack?.({ ok: false, error: 'message not found' })
      const emoji = String(data.emoji || '').slice(0, 8)
      await db.messageReaction.deleteMany({ where: { messageId: data.messageId, userId, emoji } })
      ack?.({ ok: true })
      const payload = { messageId: data.messageId, userId, emoji, action: 'remove' as const }
      io.to(room(msg.senderId)).emit('reaction:update', payload)
      if (msg.receiverId) io.to(room(msg.receiverId)).emit('reaction:update', payload)
      if (msg.groupId) {
        const members = await db.groupMember.findMany({ where: { groupId: msg.groupId } })
        for (const m of members) io.to(room(m.userId)).emit('reaction:update', payload)
      }
    } catch (e: any) {
      ack?.({ ok: false, error: e?.message })
    }
  })

  // ---------- Message delete (realtime propagation) ----------
  socket.on('message:delete', async (data: { messageId: string; scope: 'me' | 'everyone' }, ack?: (r: any) => void) => {
    if (!userId) return ack?.({ ok: false, error: 'unauth' })
    try {
      const msg = await db.message.findUnique({ where: { id: data.messageId } })
      if (!msg) return ack?.({ ok: false, error: 'not found' })
      if (data.scope === 'everyone') {
        if (msg.senderId !== userId) return ack?.({ ok: false, error: 'forbidden' })
        await db.message.update({
          where: { id: data.messageId },
          data: { deletedFor: 'everyone', content: '', fileUrl: null, fileName: null, fileSize: null, mimeType: null },
        })
        const payload = { messageId: data.messageId, scope: 'everyone' }
        io.to(room(msg.senderId)).emit('message:deleted', payload)
        if (msg.receiverId) io.to(room(msg.receiverId)).emit('message:deleted', payload)
        if (msg.groupId) {
          const members = await db.groupMember.findMany({ where: { groupId: msg.groupId } })
          for (const m of members) io.to(room(m.userId)).emit('message:deleted', payload)
        }
      } else {
        const existing = msg.deletedFor ? msg.deletedFor.split(',').filter(Boolean) : []
        if (!existing.includes(userId)) existing.push(userId)
        await db.message.update({ where: { id: data.messageId }, data: { deletedFor: existing.join(',') } })
      }
      ack?.({ ok: true })
    } catch (e: any) {
      ack?.({ ok: false, error: e?.message })
    }
  })

  socket.on('group:message:send', async (data: GroupSendPayload, ack?: (r: any) => void) => {
    if (!userId) return ack?.({ ok: false, error: 'unauth' })
    try {
      const membership = await db.groupMember.findUnique({
        where: { groupId_userId: { groupId: data.groupId, userId } },
      })
      if (!membership) {
        ack?.({ ok: false, error: 'not a member' })
        return
      }
      const msg = await db.message.create({
        data: {
          senderId: userId,
          groupId: data.groupId,
          content: data.content,
          type: data.type || 'text',
          fileUrl: data.fileUrl,
          fileName: data.fileName,
          fileSize: data.fileSize,
          mimeType: data.mimeType,
          status: 'SENT',
        },
        include: { sender: true },
      })
      ack?.({ ok: true, message: msg, tempId: data.tempId })
      const members = await db.groupMember.findMany({ where: { groupId: data.groupId } })
      for (const m of members) {
        io.to(room(m.userId)).emit('group:message:new', msg)
      }
    } catch (e: any) {
      ack?.({ ok: false, error: e?.message })
    }
  })

  // ---------- Call signaling ----------
  const forward = (targetUserId: string, event: string, payload: any) => {
    io.to(room(targetUserId)).emit(event, { ...payload, from: userId })
  }

  socket.on('call:offer', (data: { targetUserId: string; type: string; sdp: string }) => {
    if (!userId) return
    forward(data.targetUserId, 'call:incoming', {
      callerId: userId,
      type: data.type,
      sdp: data.sdp,
    })
  })

  socket.on('call:answer', (data: { targetUserId: string; sdp: string }) => {
    if (!userId) return
    forward(data.targetUserId, 'call:sdp', { kind: 'answer', sdp: data.sdp })
  })

  socket.on('call:ice', (data: { targetUserId: string; candidate: any }) => {
    if (!userId) return
    forward(data.targetUserId, 'call:ice-candidate', { candidate: data.candidate })
  })

  socket.on('call:ringing', (data: { targetUserId: string }) => {
    if (!userId) return
    forward(data.targetUserId, 'call:incoming', { callerId: userId, ringing: true })
  })

  socket.on('call:reject', (data: { targetUserId: string }) => {
    if (!userId) return
    forward(data.targetUserId, 'call:ended', { reason: 'declined', by: userId })
  })

  socket.on('call:end', (data: { targetUserId: string }) => {
    if (!userId) return
    forward(data.targetUserId, 'call:ended', { reason: 'ended', by: userId })
  })

  socket.on('disconnect', async () => {
    if (userId) {
      setOffline(userId, socket.id)
      if (!isOnline(userId)) {
        io.emit('presence', { userId, online: false })
        await updateLastSeen(userId)
      }
    }
  })
})

const PORT = 3003
httpServer.listen(PORT, () => {
  console.log(`FriendConnect realtime service running on port ${PORT}`)
})

process.on('SIGTERM', () => {
  httpServer.close(() => process.exit(0))
})
process.on('SIGINT', () => {
  httpServer.close(() => process.exit(0))
})
