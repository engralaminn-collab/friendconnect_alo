'use strict'

const fs = require('fs')
const path = require('path')
try {
  const envPath = path.join(__dirname, '.env')
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq < 1) continue
      const key = trimmed.slice(0, eq)
      if (process.env[key]) continue
      let val = trimmed.slice(eq + 1)
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1)
      process.env[key] = val
    }
  }
} catch {
  /* ignore */
}

const http = require('http')
const { Server } = require('socket.io')
const { prisma } = require('./src/lib/db-runtime.js')

const PORT = Number(process.env.SOCKET_PORT || 3003)
const APP_ORIGIN = process.env.APP_ORIGIN || process.env.NEXTAUTH_URL || true
const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, service: 'friendconnect-socket', uptime: process.uptime() }))
    return
  }
  res.writeHead(200, { 'Content-Type': 'text/plain' })
  res.end('FriendConnect realtime')
})

const io = new Server(server, {
  cors: {
    origin: APP_ORIGIN === true ? true : APP_ORIGIN.split(',').map((s) => s.trim()),
    methods: ['GET', 'POST'],
    credentials: true,
  },
  transports: ['polling', 'websocket'],
  allowEIO3: true,
  pingTimeout: 25000,
  pingInterval: 20000,
})

if (process.env.REDIS_URL) {
  try {
    const { createAdapter } = require('@socket.io/redis-adapter')
    const { Redis } = require('ioredis')
    const pub = new Redis(process.env.REDIS_URL)
    const sub = pub.duplicate()
    io.adapter(createAdapter(pub, sub))
    console.log('[socket] redis adapter enabled')
  } catch (e) {
    console.warn('[socket] redis adapter failed', e.message)
  }
}

const onlineUsers = new Map()
const socketUserMap = new Map()
const inCall = new Set()

function cookieToken(cookieHeader) {
  if (!cookieHeader) return null
  const parts = cookieHeader.split(';')
  for (const p of parts) {
    const [k, ...rest] = p.trim().split('=')
    if (k === 'fc_session') return decodeURIComponent(rest.join('='))
  }
  return null
}

async function userFromToken(token) {
  if (!token || typeof token !== 'string' || token.length < 16) return null
  const session = await prisma.session.findUnique({
    where: { token },
    include: { user: { include: { profile: true } } },
  })
  if (!session || session.expiresAt.getTime() < Date.now()) return null
  return session.user
}

function socketsOf(userId) {
  return onlineUsers.get(userId) || new Set()
}

function emitToUser(userId, event, payload) {
  for (const sid of socketsOf(userId)) io.to(sid).emit(event, payload)
}

function onlineList() {
  return Array.from(onlineUsers.keys())
}

function broadcastOnline() {
  io.emit('online:update', onlineList())
  io.emit('onlineUsers', onlineList())
}

io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token || cookieToken(socket.handshake.headers.cookie)
    if (token) {
      const user = await userFromToken(token)
      if (user) socket.data.pendingUser = user
    }
    next()
  } catch (e) {
    next()
  }
})

io.on('connection', (socket) => {
  const bindUser = async (user) => {
    if (!user) return false
    socket.data.userId = user.id
    socket.data.user = user
    socketUserMap.set(socket.id, user.id)
    if (!onlineUsers.has(user.id)) onlineUsers.set(user.id, new Set())
    onlineUsers.get(user.id).add(socket.id)
    socket.join(`user:${user.id}`)
    socket.emit('auth:ok', { userId: user.id })
    broadcastOnline()
    io.emit('presence', { userId: user.id, online: true })
    await prisma.profile.updateMany({ where: { userId: user.id }, data: { lastSeen: new Date() } }).catch(() => {})
    return true
  }

  if (socket.data.pendingUser) {
    bindUser(socket.data.pendingUser)
  }

  socket.on('auth', async (payload, ack) => {
    try {
      let user = null
      if (typeof payload === 'string') user = await userFromToken(payload)
      if (!user && socket.data.pendingUser) user = socket.data.pendingUser
      if (!user) {
        socket.emit('auth:error', { error: 'Unauthorized' })
        if (typeof ack === 'function') ack({ ok: false })
        return
      }
      await bindUser(user)
      if (typeof ack === 'function') ack({ ok: true, userId: user.id })
    } catch (e) {
      socket.emit('auth:error', { error: 'Unauthorized' })
      if (typeof ack === 'function') ack({ ok: false })
    }
  })

  const requireAuth = () => socket.data.userId

  socket.on('message:send', async (data, ack) => {
    const senderId = requireAuth()
    if (!senderId || !data?.receiverId) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Unauthorized' })
      return
    }
    try {
      const blocked = await prisma.friendship.findFirst({
        where: {
          status: 'BLOCKED',
          OR: [
            { requesterId: senderId, receiverId: data.receiverId },
            { requesterId: data.receiverId, receiverId: senderId },
          ],
        },
      })
      if (blocked) {
        if (typeof ack === 'function') ack({ ok: false, error: 'Blocked' })
        return
      }
      const msg = await prisma.message.create({
        data: {
          senderId,
          receiverId: data.receiverId,
          content: String(data.content || data.message || ''),
          type: data.type || 'text',
          fileUrl: data.fileUrl || null,
          fileName: data.fileName || null,
          fileSize: data.fileSize || null,
          mimeType: data.mimeType || null,
          replyToId: data.replyToId || null,
          status: socketsOf(data.receiverId).size ? 'DELIVERED' : 'SENT',
        },
      })
      const payload = {
        id: msg.id,
        senderId,
        receiverId: data.receiverId,
        content: msg.content,
        type: msg.type,
        fileUrl: msg.fileUrl,
        fileName: msg.fileName,
        fileSize: msg.fileSize,
        mimeType: msg.mimeType,
        replyToId: msg.replyToId,
        status: msg.status,
        createdAt: msg.createdAt.toISOString(),
        tempId: data.tempId,
      }
      emitToUser(data.receiverId, 'message:new', payload)
      emitToUser(senderId, 'message:new', payload)
      if (typeof ack === 'function') ack({ ok: true, message: payload, tempId: data.tempId })
      notifyUser(data.receiverId, {
        type: 'message',
        title: socket.data.user?.name || 'New message',
        body: msg.content?.slice(0, 80) || 'Sent you a message',
      }).catch(() => {})
    } catch (e) {
      if (typeof ack === 'function') ack({ ok: false, error: e.message })
    }
  })

  socket.on('group:message:send', async (data, ack) => {
    const senderId = requireAuth()
    if (!senderId || !data?.groupId) {
      if (typeof ack === 'function') ack({ ok: false })
      return
    }
    try {
      const membership = await prisma.groupMember.findUnique({
        where: { groupId_userId: { groupId: data.groupId, userId: senderId } },
      })
      if (!membership) {
        if (typeof ack === 'function') ack({ ok: false, error: 'Not a member' })
        return
      }
      const msg = await prisma.message.create({
        data: {
          senderId,
          groupId: data.groupId,
          content: String(data.content || data.message || ''),
          type: data.type || 'text',
          fileUrl: data.fileUrl || null,
          fileName: data.fileName || null,
          fileSize: data.fileSize || null,
          mimeType: data.mimeType || null,
          replyToId: data.replyToId || null,
          status: 'SENT',
        },
        include: { sender: { include: { profile: true } } },
      })
      const payload = {
        id: msg.id,
        senderId,
        groupId: data.groupId,
        content: msg.content,
        type: msg.type,
        fileUrl: msg.fileUrl,
        fileName: msg.fileName,
        fileSize: msg.fileSize,
        mimeType: msg.mimeType,
        replyToId: msg.replyToId,
        status: msg.status,
        createdAt: msg.createdAt.toISOString(),
        senderName: msg.sender.name,
        senderPhoto: msg.sender.profile?.photoUrl || null,
        sender: { id: msg.sender.id, name: msg.sender.name, profile: { photoUrl: msg.sender.profile?.photoUrl || null } },
        tempId: data.tempId,
      }
      const members = await prisma.groupMember.findMany({ where: { groupId: data.groupId } })
      for (const m of members) emitToUser(m.userId, 'group:message:new', payload)
      if (typeof ack === 'function') ack({ ok: true, message: payload, tempId: data.tempId })
    } catch (e) {
      if (typeof ack === 'function') ack({ ok: false, error: e.message })
    }
  })

  socket.on('message:seen', async ({ messageId }) => {
    const me = requireAuth()
    if (!me || !messageId) return
    const msg = await prisma.message.update({
      where: { id: messageId },
      data: { status: 'SEEN', seenAt: new Date() },
    }).catch(() => null)
    if (msg) emitToUser(msg.senderId, 'message:status', { id: msg.id, status: 'SEEN' })
  })

  socket.on('typing', ({ receiverId, isTyping }) => {
    const me = requireAuth()
    if (!me || !receiverId) return
    emitToUser(receiverId, 'typing:indicator', { userId: me, isTyping: !!isTyping })
  })

  socket.on('group:typing', async ({ groupId, isTyping }) => {
    const me = requireAuth()
    if (!me || !groupId) return
    const members = await prisma.groupMember.findMany({ where: { groupId } }).catch(() => [])
    for (const m of members) {
      if (m.userId !== me) emitToUser(m.userId, 'group:typing:indicator', { userId: me, groupId, isTyping: !!isTyping })
    }
  })

  socket.on('reaction:add', async ({ messageId, emoji }) => {
    const me = requireAuth()
    if (!me || !messageId || !emoji) return
    await prisma.messageReaction.upsert({
      where: { messageId_userId_emoji: { messageId, userId: me, emoji } },
      update: {},
      create: { messageId, userId: me, emoji },
    }).catch(() => {})
    const msg = await prisma.message.findUnique({ where: { id: messageId } })
    const payload = { messageId, userId: me, emoji, op: 'add' }
    if (msg?.receiverId) {
      emitToUser(msg.receiverId, 'reaction:update', payload)
      emitToUser(msg.senderId, 'reaction:update', payload)
    } else if (msg?.groupId) {
      const members = await prisma.groupMember.findMany({ where: { groupId: msg.groupId } })
      for (const m of members) emitToUser(m.userId, 'reaction:update', payload)
    }
  })

  socket.on('reaction:remove', async ({ messageId, emoji }) => {
    const me = requireAuth()
    if (!me || !messageId) return
    await prisma.messageReaction.deleteMany({ where: { messageId, userId: me, emoji } }).catch(() => {})
    const msg = await prisma.message.findUnique({ where: { id: messageId } })
    const payload = { messageId, userId: me, emoji, op: 'remove' }
    if (msg?.receiverId) {
      emitToUser(msg.receiverId, 'reaction:update', payload)
      emitToUser(msg.senderId, 'reaction:update', payload)
    }
  })

  socket.on('message:delete', async ({ messageId, scope }) => {
    const me = requireAuth()
    if (!me || !messageId) return
    const msg = await prisma.message.findUnique({ where: { id: messageId } })
    if (!msg || msg.senderId !== me) return
    const deletedFor = scope === 'everyone' ? 'everyone' : 'me'
    await prisma.message.update({
      where: { id: messageId },
      data: { deletedFor, content: deletedFor === 'everyone' ? '' : msg.content },
    })
    const payload = { id: messageId, deletedFor }
    if (msg.receiverId) {
      emitToUser(msg.receiverId, 'message:deleted', payload)
      emitToUser(msg.senderId, 'message:deleted', payload)
    }
  })

  socket.on('message:edit', async ({ messageId, content }, ack) => {
    const me = requireAuth()
    if (!me || !messageId) {
      if (typeof ack === 'function') ack({ ok: false })
      return
    }
    const msg = await prisma.message.findUnique({ where: { id: messageId } })
    if (!msg || msg.senderId !== me) {
      if (typeof ack === 'function') ack({ ok: false })
      return
    }
    const updated = await prisma.message.update({
      where: { id: messageId },
      data: { content: String(content || ''), edited: true, editedAt: new Date() },
    })
    const payload = { id: messageId, content: updated.content, edited: true, editedAt: updated.editedAt.toISOString() }
    if (msg.receiverId) {
      emitToUser(msg.receiverId, 'message:edited', payload)
      emitToUser(msg.senderId, 'message:edited', payload)
    }
    if (typeof ack === 'function') ack({ ok: true, message: payload })
  })

  function relayCall(event, payload, extraEvents) {
    const me = requireAuth()
    const target = payload?.targetUserId || payload?.receiverId
    if (!me || !target) return
    const body = { ...payload, from: me, senderId: me, callerId: payload.callerId || me }
    emitToUser(target, event, body)
    if (extraEvents) extraEvents.forEach((ev) => emitToUser(target, ev, body))
  }

  socket.on('call:invite', async (payload) => {
    const me = requireAuth()
    const target = payload?.targetUserId
    if (!me || !target) return
    if (inCall.has(target) && !socketsOf(target).size) {
      socket.emit('call:busy', { targetUserId: target })
      return
    }
    if (!socketsOf(target).size) {
      socket.emit('call:unavailable', { targetUserId: target })
      return
    }
    inCall.add(me)
    const user = socket.data.user
    emitToUser(target, 'call:incoming', {
      callerId: me,
      type: payload.type || 'audio',
      name: user?.name,
      photoUrl: user?.profile?.photoUrl || null,
    })
    await prisma.call.create({
      data: { callerId: me, receiverId: target, type: payload.type || 'audio', status: 'ringing' },
    }).catch(() => {})
  })

  socket.on('call:ringing', (p) => relayCall('call:ringing', p))
  socket.on('call:accepted', (p) => {
    const me = requireAuth()
    if (me) inCall.add(me)
    relayCall('call:accepted', p, ['call:accepted'])
  })
  socket.on('call:rejected', (p) => {
    const me = requireAuth()
    if (me) inCall.delete(me)
    if (p?.targetUserId) inCall.delete(p.targetUserId)
    relayCall('call:rejected', p, ['call:ended'])
  })
  socket.on('call:busy', (p) => relayCall('call:busy', p))
  socket.on('call:offer', (p) => {
    relayCall('call:offer', { ...p, sdp: p.sdp || p.offer })
  })
  socket.on('call:answer', (p) => {
    relayCall('call:answer', { ...p, sdp: p.sdp || p.answer })
    relayCall('call:sdp', { kind: 'answer', sdp: p.sdp || p.answer, from: requireAuth() })
  })
  socket.on('call:ice', (p) => {
    relayCall('call:ice', p)
    relayCall('call:ice-candidate', p)
  })
  socket.on('call:connected', (p) => relayCall('call:connected', p))
  socket.on('call:failed', (p) => {
    const me = requireAuth()
    if (me) inCall.delete(me)
    if (p?.targetUserId) inCall.delete(p.targetUserId)
    relayCall('call:failed', p, ['call:ended'])
  })
  socket.on('call:ended', (p) => {
    const me = requireAuth()
    if (me) inCall.delete(me)
    if (p?.targetUserId) inCall.delete(p.targetUserId)
    relayCall('call:ended', p)
  })
  socket.on('call:end', (p) => {
    const me = requireAuth()
    if (me) inCall.delete(me)
    relayCall('call:ended', p)
  })
  socket.on('call:reject', (p) => {
    const me = requireAuth()
    if (me) inCall.delete(me)
    relayCall('call:rejected', p, ['call:ended'])
  })
  socket.on('call:cancelled', (p) => {
    const me = requireAuth()
    if (me) inCall.delete(me)
    if (p?.targetUserId) inCall.delete(p.targetUserId)
    relayCall('call:ended', { ...p, reason: 'cancelled' })
  })

  socket.on('disconnect', async () => {
    const userId = socketUserMap.get(socket.id)
    socketUserMap.delete(socket.id)
    if (userId && onlineUsers.has(userId)) {
      const set = onlineUsers.get(userId)
      set.delete(socket.id)
      if (set.size === 0) {
        onlineUsers.delete(userId)
        inCall.delete(userId)
        io.emit('presence', { userId, online: false })
        await prisma.profile.updateMany({ where: { userId }, data: { lastSeen: new Date() } }).catch(() => {})
      }
      broadcastOnline()
    }
  })
})

async function notifyUser(userId, n) {
  const row = await prisma.notification.create({
    data: { userId, type: n.type, title: n.title, body: n.body },
  })
  emitToUser(userId, 'notification', {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    read: false,
  })
}

async function runJobs() {
  const now = new Date()
  try {
    const due = await prisma.message.findMany({
      where: { scheduledFor: { lte: now }, status: 'SENT', deletedFor: { not: 'everyone' } },
      take: 50,
    })
    for (const msg of due) {
      if (!msg.receiverId && !msg.groupId) continue
      if (!msg.content && !msg.fileUrl) continue
      const payload = {
        id: msg.id,
        senderId: msg.senderId,
        receiverId: msg.receiverId,
        groupId: msg.groupId,
        content: msg.content,
        type: msg.type,
        fileUrl: msg.fileUrl,
        status: 'SENT',
        createdAt: msg.createdAt.toISOString(),
        scheduled: true,
      }
      if (msg.receiverId) {
        emitToUser(msg.receiverId, 'message:new', payload)
        emitToUser(msg.senderId, 'message:new', payload)
      }
      await prisma.message.update({ where: { id: msg.id }, data: { scheduledFor: null } }).catch(() => {})
    }
  } catch (e) {
    console.warn('[jobs] scheduled messages', e.message)
  }
  try {
    const reminders = await prisma.messageReminder.findMany({
      where: { notified: false, remindAt: { lte: now } },
      include: { message: true },
      take: 50,
    })
    for (const r of reminders) {
      await notifyUser(r.userId, {
        type: 'reminder',
        title: 'Message reminder',
        body: r.message?.content?.slice(0, 80) || 'You asked to be reminded about a message',
      })
      await prisma.messageReminder.update({ where: { id: r.id }, data: { notified: true } })
    }
  } catch (e) {
    console.warn('[jobs] reminders', e.message)
  }
}

setInterval(() => {
  runJobs().catch(() => {})
}, 30000)

server.listen(PORT, '0.0.0.0', () => {
  console.log(`FriendConnect realtime on 0.0.0.0:${PORT}`)
})

process.on('SIGTERM', async () => {
  await prisma.$disconnect()
  server.close(() => process.exit(0))
})
