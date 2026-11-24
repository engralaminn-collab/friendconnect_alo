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
const {
  createHandshakeMiddleware,
  isSessionActive,
  isMessageParticipant,
  canInteract,
  eventRateLimit,
} = require('./src/lib/socket-security.cjs')
const fileAccess = require('./src/lib/file-access.cjs')

// Finding #10: socket-sent attachments must create the same `FileAccess`
// grants the REST route creates, otherwise the attachment the recipient just
// received over the socket returns 403 when they open it.
fileAccess.setStoreProvider(() => prisma)

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

let rateRedis = null
if (process.env.REDIS_URL) {
  try {
    const { createAdapter } = require('@socket.io/redis-adapter')
    const { Redis } = require('ioredis')
    const pub = new Redis(process.env.REDIS_URL)
    const sub = pub.duplicate()
    rateRedis = pub.duplicate()
    io.adapter(createAdapter(pub, sub))
    console.log('[socket] redis adapter enabled')
  } catch (e) {
    console.warn('[socket] redis adapter failed', e.message)
  }
}

const onlineUsers = new Map()
const socketUserMap = new Map()
const inCall = new Set()
const localRateBuckets = new Map()

async function allowLimit(key, max, windowSeconds) {
  if (rateRedis) {
    try {
      const count = await rateRedis.incr(key)
      if (count === 1) await rateRedis.expire(key, windowSeconds)
      return count <= max
    } catch (e) {
      console.warn('[socket] shared rate-limit store unavailable; using process-local limit')
    }
  }
  // Local counters support the current single-process PM2 deployment. When
  // scaling to multiple socket-server instances, configure REDIS_URL so limits
  // are shared and presence/socket rooms use the Redis adapter.
  const now = Date.now()
  const previous = localRateBuckets.get(key)
  const bucket = !previous || previous.expires <= now
    ? { count: 0, expires: now + windowSeconds * 1000 }
    : previous
  bucket.count += 1
  localRateBuckets.set(key, bucket)
  if (localRateBuckets.size > 10000) {
    for (const [bucketKey, value] of localRateBuckets) {
      if (value.expires <= now) localRateBuckets.delete(bucketKey)
    }
  }
  return bucket.count <= max
}

async function allowSocketEvent(userId, event) {
  const policy = eventRateLimit(event)
  if (!policy) return true
  return allowLimit(`fc:socket-rate:${userId}:${event}`, policy.max, policy.windowSeconds)
}

function socketsOf(userId) {
  return onlineUsers.get(userId) || new Set()
}

async function isUserOnline(userId) {
  try {
    const sockets = await io.in(`user:${userId}`).fetchSockets()
    return sockets.length > 0
  } catch {
    return socketsOf(userId).size > 0
  }
}

function emitToUser(userId, event, payload) {
  io.to(`user:${userId}`).emit(event, payload)
}

async function broadcastPresenceFor(userId, online) {
  const friendships = await prisma.friendship.findMany({
    where: {
      status: 'ACCEPTED',
      OR: [{ requesterId: userId }, { receiverId: userId }],
    },
  }).catch(() => [])
  const friendIds = friendships.map((f) => f.requesterId === userId ? f.receiverId : f.requesterId)
  for (const friendId of friendIds) {
    const blocked = await prisma.block.findFirst({
      where: { OR: [{ fromId: userId, toId: friendId }, { fromId: friendId, toId: userId }] },
      select: { id: true },
    }).catch(() => ({ id: 'blocked' }))
    if (blocked) continue
    const profile = await prisma.profile.findUnique({ where: { userId }, select: { profileVisibility: true } }).catch(() => null)
    if (!profile || profile.profileVisibility === 'PRIVATE') continue
    emitToUser(friendId, 'presence', { userId, online: !!online })
    await sendPresenceSnapshot(friendId)
  }
}

async function sendPresenceSnapshot(userId) {
  const friendships = await prisma.friendship.findMany({
    where: {
      status: 'ACCEPTED',
      OR: [{ requesterId: userId }, { receiverId: userId }],
    },
  }).catch(() => [])
  const friendIds = friendships.map((f) => f.requesterId === userId ? f.receiverId : f.requesterId)
  const visible = []
  for (const friendId of friendIds) {
    if (!(await isUserOnline(friendId))) continue
    const [blocked, profile] = await Promise.all([
      prisma.block.findFirst({
        where: { OR: [{ fromId: userId, toId: friendId }, { fromId: friendId, toId: userId }] },
        select: { id: true },
      }).catch(() => ({ id: 'blocked' })),
      prisma.profile.findUnique({ where: { userId: friendId }, select: { profileVisibility: true } }).catch(() => null),
    ])
    if (!blocked && profile && profile.profileVisibility !== 'PRIVATE') visible.push(friendId)
  }
  emitToUser(userId, 'online:update', visible)
  emitToUser(userId, 'onlineUsers', visible)
  for (const friendId of visible) emitToUser(userId, 'presence', { userId: friendId, online: true })
}

const authenticateSocket = createHandshakeMiddleware(prisma)
io.use(async (socket, next) => {
  const remote = String(socket.handshake.address || 'unknown').slice(0, 128)
  const allowed = await allowLimit(`fc:socket-auth:${remote}`, 60, 60)
  if (!allowed) return next(new Error('rate_limited'))
  return authenticateSocket(socket, next)
})

io.on('connection', (socket) => {
  socket.use(async (packet, next) => {
    try {
      if (!(await isSessionActive(prisma, socket.data.authenticatedSessionToken))) {
        socket.disconnect(true)
        return next(new Error('unauthorized'))
      }
      if (Buffer.byteLength(JSON.stringify(packet), 'utf8') > 64 * 1024) {
        return next(new Error('payload_too_large'))
      }
      const userId = socket.data.userId
      if (userId && !(await allowSocketEvent(userId, String(packet[0] || '')))) {
        return next(new Error('rate_limited'))
      }
      return next()
    } catch {
      socket.disconnect(true)
      return next(new Error('unauthorized'))
    }
  })

  const bindUser = async (user) => {
    if (!user) return false
    socket.data.userId = user.id
    socket.data.user = user
    socketUserMap.set(socket.id, user.id)
    if (!onlineUsers.has(user.id)) onlineUsers.set(user.id, new Set())
    onlineUsers.get(user.id).add(socket.id)
    socket.join(`user:${user.id}`)
    socket.emit('auth:ok', { userId: user.id })
    await sendPresenceSnapshot(user.id)
    if (onlineUsers.get(user.id).size === 1) await broadcastPresenceFor(user.id, true)
    await prisma.profile.updateMany({ where: { userId: user.id }, data: { lastSeen: new Date() } }).catch(() => {})
    return true
  }

  if (socket.data.pendingUser) {
    bindUser(socket.data.pendingUser)
  }

  socket.on('auth', async (_payload, ack) => {
    // Authentication is completed and bound during the handshake. The legacy
    // event remains as an acknowledgement only; it cannot switch identities.
    const active = await isSessionActive(prisma, socket.data.authenticatedSessionToken)
    if (!active || !socket.data.userId) {
      socket.emit('auth:error', { error: 'Unauthorized' })
      if (typeof ack === 'function') ack({ ok: false })
      socket.disconnect(true)
      return
    }
    if (typeof ack === 'function') ack({ ok: true, userId: socket.data.userId })
  })

  const sessionTimer = setInterval(async () => {
    if (!(await isSessionActive(prisma, socket.data.authenticatedSessionToken))) socket.disconnect(true)
  }, 30_000)
  sessionTimer.unref?.()

  const requireAuth = () => socket.data.userId

  /**
   * Conversation-scoped helpers.
   *
   * The chat UI talks in conversations (`conversationId`), which is how the schema
   * models a thread: `Message.conversationId` is the field the chat view reads
   * back. Only the older DM/group handlers existed here, so every send from the UI
   * was dropped — `message:send` without `receiverId` was refused with
   * "Unauthorized", and a message stored without `conversationId` never appeared in
   * the thread.
   */
  function conversationIdOf(data) {
    return typeof data?.conversationId === 'string' ? data.conversationId : null
  }

  async function memberIdsOf(conversationId) {
    const members = await prisma.conversationMember.findMany({
      where: { conversationId },
      select: { userId: true },
    }).catch(() => [])
    return members.map((m) => m.userId)
  }

  async function requireMembership(conversationId, userId) {
    if (!conversationId || !userId) return null
    return prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
      select: { conversationId: true },
    }).catch(() => null)
  }

  /** Members other than the sender; a direct conversation has exactly one. */
  async function conversationPeers(conversationId, userId) {
    return (await memberIdsOf(conversationId)).filter((id) => id !== userId)
  }

  function messagePayload(msg) {
    return {
      id: msg.id,
      senderId: msg.senderId,
      receiverId: msg.receiverId ?? null,
      groupId: msg.groupId ?? null,
      conversationId: msg.conversationId ?? null,
      content: msg.content,
      type: msg.type,
      fileUrl: msg.fileUrl,
      fileName: msg.fileName,
      fileSize: msg.fileSize,
      mimeType: msg.mimeType,
      replyToId: msg.replyToId,
      status: msg.status,
      createdAt: msg.createdAt instanceof Date ? msg.createdAt.toISOString() : msg.createdAt,
    }
  }

  socket.on('conversation:join', async (conversationId) => {
    const me = requireAuth()
    if (!me || typeof conversationId !== 'string') return
    // Joining is an acknowledgement only: every broadcast goes to `user:<id>`
    // rooms, so being in this room grants no read access on its own.
    if (!(await requireMembership(conversationId, me))) return
    socket.join(`conversation:${conversationId}`)
  })

  socket.on('message:send', async (data, ack) => {
    const conversationId = conversationIdOf(data)
    if (conversationId) {
      const senderId = requireAuth()
      const fail = (error) => { if (typeof ack === 'function') ack({ ok: false, error }) }
      if (!senderId) return fail('Unauthorized')
      if (!(await requireMembership(conversationId, senderId))) return fail('Not a member')
      const content = String(data.content || '')
      if (content.length > 10000) return fail('Message too long')
      if (!content.trim()) return fail('Empty message')
      try {
        const peers = await conversationPeers(conversationId, senderId)
        const msg = await prisma.message.create({
          data: {
            conversationId,
            senderId,
            // A direct conversation keeps the receiver so the DM-oriented
            // endpoints (receipts, notifications) stay meaningful; groups leave it
            // null.
            receiverId: peers.length === 1 ? peers[0] : null,
            content,
            type: data.type || 'text',
            replyToId: typeof data.replyToId === 'string' ? data.replyToId : null,
            status: 'SENT',
          },
        })
        const payload = messagePayload(msg)
        for (const userId of await memberIdsOf(conversationId)) {
          emitToUser(userId, 'message:new', payload)
        }
        if (typeof ack === 'function') ack({ ok: true, message: payload, tempId: data.tempId })
        for (const peer of peers) {
          notifyUser(peer, {
            type: 'message',
            title: socket.data.user?.name || 'New message',
            body: content.slice(0, 80),
          }).catch(() => {})
        }
      } catch (e) {
        if (typeof ack === 'function') ack({ ok: false, error: e.message })
      }
      return
    }

    const senderId = requireAuth()
    if (!senderId || !data?.receiverId || typeof data.receiverId !== 'string') {
      if (typeof ack === 'function') ack({ ok: false, error: 'Unauthorized' })
      return
    }
    const content = String(data.content || data.message || '')
    if (content.length > 10000) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Message too long' })
      return
    }
    try {
      if (!(await canInteract(prisma, senderId, data.receiverId, 'messagePermission'))) {
        if (typeof ack === 'function') ack({ ok: false, error: 'Not permitted to message this user' })
        return
      }
      if (data.fileUrl) {
        const ownedFile = await prisma.file.findFirst({ where: { url: String(data.fileUrl), ownerId: senderId }, select: { id: true } }).catch(() => null)
        if (!ownedFile) {
          if (typeof ack === 'function') ack({ ok: false, error: 'Attachment is not owned by sender' })
          return
        }
      }
      const msg = await prisma.message.create({
        data: {
          senderId,
          receiverId: data.receiverId,
          content,
          type: data.type || 'text',
          fileUrl: data.fileUrl || null,
          fileName: data.fileName || null,
          fileSize: data.fileSize || null,
          mimeType: data.mimeType || null,
          replyToId: data.replyToId || null,
          status: await isUserOnline(data.receiverId) ? 'DELIVERED' : 'SENT',
        },
      })
      await fileAccess.grantMessageFileAccess(msg)
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
    if (!senderId || typeof data?.groupId !== 'string') {
      if (typeof ack === 'function') ack({ ok: false })
      return
    }
    const groupContent = String(data.content || data.message || '')
    if (groupContent.length > 10000) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Message too long' })
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
      if (data.fileUrl) {
        const ownedFile = await prisma.file.findFirst({ where: { url: String(data.fileUrl), ownerId: senderId }, select: { id: true } }).catch(() => null)
        if (!ownedFile) {
          if (typeof ack === 'function') ack({ ok: false, error: 'Attachment is not owned by sender' })
          return
        }
      }
      const msg = await prisma.message.create({
        data: {
          senderId,
          groupId: data.groupId,
          content: groupContent,
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
      await fileAccess.grantMessageFileAccess(msg)
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

  socket.on('message:seen', async ({ messageId } = {}) => {
    const me = requireAuth()
    if (!me || typeof messageId !== 'string') return
    const msg = await prisma.message.findUnique({ where: { id: messageId } }).catch(() => null)
    // A read receipt can only be issued by the direct-message recipient.
    if (!msg || msg.groupId || msg.receiverId !== me || !(await isMessageParticipant(prisma, me, msg))) return
    const profile = await prisma.profile.findUnique({ where: { userId: me }, select: { readReceipts: true } }).catch(() => null)
    if (profile?.readReceipts === false) return
    const updated = await prisma.message.updateMany({
      where: { id: messageId, receiverId: me },
      data: { status: 'SEEN', seenAt: new Date() },
    }).catch(() => ({ count: 0 }))
    if (updated.count) emitToUser(msg.senderId, 'message:status', { id: msg.id, status: 'SEEN' })
  })

  socket.on('typing', async ({ receiverId, isTyping } = {}) => {
    const me = requireAuth()
    if (!me || typeof receiverId !== 'string') return
    if (!(await canInteract(prisma, me, receiverId, 'messagePermission'))) return
    emitToUser(receiverId, 'typing:indicator', { userId: me, isTyping: !!isTyping })
  })

  socket.on('group:typing', async ({ groupId, isTyping } = {}) => {
    const me = requireAuth()
    if (!me || typeof groupId !== 'string') return
    const membership = await prisma.groupMember.findUnique({ where: { groupId_userId: { groupId, userId: me } } }).catch(() => null)
    if (!membership) return
    const members = await prisma.groupMember.findMany({ where: { groupId } }).catch(() => [])
    for (const m of members) {
      if (m.userId !== me) emitToUser(m.userId, 'group:typing:indicator', { userId: me, groupId, isTyping: !!isTyping })
    }
  })

  // --- Conversation-scoped events the chat UI emits -----------------------
  // `typing:start`/`typing:stop` carry a conversation id (the older `typing` event
  // carries a receiver id), and `message:read` marks the conversation read and
  // emits the per-message receipt the UI listens for.
  async function relayTyping(conversationId, isTyping) {
    const me = requireAuth()
    if (!me || typeof conversationId !== 'string') return
    if (!(await requireMembership(conversationId, me))) return
    for (const userId of await memberIdsOf(conversationId)) {
      if (userId !== me) emitToUser(userId, 'typing:update', { conversationId, userId: me, isTyping })
    }
  }

  socket.on('typing:start', (data) => relayTyping(typeof data === 'string' ? data : conversationIdOf(data), true).catch(() => {}))
  socket.on('typing:stop', (data) => relayTyping(typeof data === 'string' ? data : conversationIdOf(data), false).catch(() => {}))

  socket.on('message:read', async (data = {}) => {
    const me = requireAuth()
    const conversationId = conversationIdOf(data)
    if (!me || !conversationId) return
    if (!(await requireMembership(conversationId, me))) return
    await prisma.conversationMember.updateMany({
      where: { conversationId, userId: me },
      data: { lastReadAt: new Date() },
    }).catch(() => {})
    const members = await memberIdsOf(conversationId)
    for (const userId of members) {
      if (userId !== me) emitToUser(userId, 'message:read', { conversationId, userId: me })
    }

    // Direct conversations additionally carry a per-message delivery status.
    const peers = members.filter((id) => id !== me)
    if (peers.length !== 1) return
    const profile = await prisma.profile.findUnique({ where: { userId: me }, select: { readReceipts: true } }).catch(() => null)
    if (profile?.readReceipts === false) return
    const senderId = peers[0]
    const unread = await prisma.message.findMany({
      where: { conversationId, senderId, status: { not: 'SEEN' } },
      select: { id: true },
    }).catch(() => [])
    if (!unread.length) return
    await prisma.message.updateMany({
      where: { conversationId, senderId, status: { not: 'SEEN' } },
      data: { status: 'SEEN', seenAt: new Date() },
    }).catch(() => {})
    for (const row of unread) emitToUser(senderId, 'message:status', { id: row.id, status: 'SEEN' })
  })

  // `message:react` toggles a reaction and is what the chat UI emits; the older
  // `reaction:add` / `reaction:remove` events remain for other clients.
  socket.on('message:react', async (data = {}, ack) => {
    const me = requireAuth()
    const messageId = typeof data.messageId === 'string' ? data.messageId : null
    const emoji = typeof data.emoji === 'string' ? data.emoji : ''
    const fail = (error) => { if (typeof ack === 'function') ack({ ok: false, error }) }
    if (!me || !messageId) return fail('Unauthorized')
    if (!emoji || emoji.length > 32) return fail('Invalid emoji')
    const message = await prisma.message.findUnique({ where: { id: messageId } }).catch(() => null)
    if (!message) return fail('Not found')
    // A non-participant gets the same answer as a missing message, so an id cannot
    // be probed for existence.
    if (!(await isMessageParticipant(prisma, me, message))) return fail('Not found')
    const existing = await prisma.messageReaction.findUnique({
      where: { messageId_userId_emoji: { messageId, userId: me, emoji } },
    }).catch(() => null)
    if (existing) {
      await prisma.messageReaction.delete({ where: { id: existing.id } }).catch(() => {})
    } else {
      await prisma.messageReaction.create({ data: { messageId, userId: me, emoji } }).catch(() => {})
    }
    const payload = {
      messageId,
      conversationId: message.conversationId ?? null,
      userId: me,
      emoji,
      op: existing ? 'remove' : 'add',
    }
    const recipients = message.conversationId
      ? await memberIdsOf(message.conversationId)
      : [message.senderId, message.receiverId].filter(Boolean)
    for (const userId of recipients) emitToUser(userId, 'message:reaction', payload)
    if (typeof ack === 'function') ack({ ok: true, ...payload })
  })

  socket.on('reaction:add', async ({ messageId, emoji } = {}) => {
    const me = requireAuth()
    if (!me || typeof messageId !== 'string' || typeof emoji !== 'string' || !emoji || emoji.length > 32) return
    const message = await prisma.message.findUnique({ where: { id: messageId } }).catch(() => null)
    if (!(await isMessageParticipant(prisma, me, message))) return
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

  socket.on('reaction:remove', async ({ messageId, emoji } = {}) => {
    const me = requireAuth()
    if (!me || typeof messageId !== 'string' || typeof emoji !== 'string') return
    const message = await prisma.message.findUnique({ where: { id: messageId } }).catch(() => null)
    if (!(await isMessageParticipant(prisma, me, message))) return
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
    // Withdrawing an attachment revokes only the grants this message created,
    // so the same upload stays reachable in any other thread that shares it.
    if (deletedFor === 'everyone') await fileAccess.revokeMessageGrants(msg)
    const payload = { id: messageId, conversationId: msg.conversationId ?? null, deletedFor }
    // A conversation message must reach every member: the chat UI drops the row
    // from an open thread on this event.
    const recipients = msg.conversationId
      ? await memberIdsOf(msg.conversationId)
      : [msg.senderId, msg.receiverId].filter(Boolean)
    for (const userId of recipients) emitToUser(userId, 'message:deleted', payload)
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

  function callTarget(payload) {
    return payload?.targetUserId || payload?.receiverId || payload?.toUserId || null
  }

  async function relayCall(event, payload = {}, extraEvents = []) {
    const me = requireAuth()
    const target = callTarget(payload)
    const callId = payload?.callId
    if (!me || typeof target !== 'string' || typeof callId !== 'string') return false
    const call = await prisma.call.findUnique({ where: { id: callId } }).catch(() => null)
    if (!call || !['ringing', 'connected'].includes(call.status)) return false
    const isCaller = call.callerId === me && call.receiverId === target
    const isCallee = call.receiverId === me && call.callerId === target
    if (!isCaller && !isCallee) return false
    // Re-check current block and call-visibility policy on every signaling event.
    if (!(await canInteract(prisma, me, target, 'callPermission'))) return false

    if (event === 'call:accepted') {
      if (!isCallee || call.status !== 'ringing') return false
      await prisma.call.update({ where: { id: callId }, data: { status: 'connected', answeredAt: new Date() } }).catch(() => {})
      inCall.add(me)
      inCall.add(target)
    } else if (['call:rejected', 'call:busy', 'call:ended', 'call:failed', 'call:cancelled'].includes(event)) {
      if ((event === 'call:cancelled' || event === 'call:ended' && call.status === 'ringing') && !isCaller) return false
      if ((event === 'call:rejected' || event === 'call:busy') && !isCallee) return false
      const status = event === 'call:failed' ? 'failed' : event === 'call:cancelled' ? 'cancelled' : event === 'call:busy' ? 'busy' : event === 'call:rejected' ? 'declined' : 'ended'
      await prisma.call.update({ where: { id: callId }, data: { status, endedAt: new Date() } }).catch(() => {})
      inCall.delete(me)
      inCall.delete(target)
    } else if (event === 'call:ringing' && isCallee && call.status === 'ringing') {
      // Acknowledgement that the target's client received the invite.
    } else if (call.status !== 'connected' && !(event === 'call:offer' && isCaller)) {
      // The caller may send the SDP offer while ringing. All further traffic
      // requires acceptance and is constrained to the same two participants.
      return false
    }

    const body = {
      ...payload,
      from: me,
      fromUserId: me,
      senderId: me,
      callerId: call.callerId,
      targetUserId: target,
      toUserId: target,
      callId,
    }
    emitToUser(target, event, body)
    for (const alias of extraEvents) emitToUser(target, alias, body)
    return true
  }

  socket.on('call:invite', async (payload = {}, ack) => {
    const me = requireAuth()
    const target = callTarget(payload)
    const type = payload.type === 'video' || payload.callType === 'video' ? 'video' : 'audio'
    if (!me || typeof target !== 'string') {
      if (typeof ack === 'function') ack({ ok: false, error: 'Unauthorized' })
      return
    }
    if (!(await canInteract(prisma, me, target, 'callPermission'))) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Call not permitted' })
      return
    }
    const activeCall = await prisma.call.findFirst({
      where: {
        status: { in: ['ringing', 'connected'] },
        OR: [{ callerId: me }, { receiverId: me }, { callerId: target }, { receiverId: target }],
      },
      select: { id: true },
    }).catch(() => null)
    if (activeCall || inCall.has(me) || inCall.has(target)) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Busy' })
      return
    }
    if (!(await isUserOnline(target))) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Unavailable' })
      socket.emit('call:unavailable', { targetUserId: target })
      return
    }
    const call = await prisma.call.create({
      data: { callerId: me, receiverId: target, type, status: 'ringing' },
    }).catch(() => null)
    if (!call) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Unable to start call' })
      return
    }
    inCall.add(me)
    const user = socket.data.user
    emitToUser(target, 'call:incoming', {
      callerId: me,
      fromUserId: me,
      targetUserId: target,
      callId: call.id,
      type,
      callType: type,
      name: user?.name,
      photoUrl: user?.profile?.photoUrl || null,
    })
    if (typeof ack === 'function') ack({ ok: true, callId: call.id })
  })

  socket.on('call:ringing', (p = {}) => { relayCall('call:ringing', p).catch(() => {}) })
  socket.on('call:accepted', (p = {}) => { relayCall('call:accepted', p).catch(() => {}) })
  socket.on('call:rejected', (p = {}) => { relayCall('call:rejected', p).catch(() => {}) })
  socket.on('call:busy', (p = {}) => { relayCall('call:busy', p).catch(() => {}) })
  socket.on('call:offer', (p = {}) => { relayCall('call:offer', { ...p, sdp: p.sdp || p.offer }).catch(() => {}) })
  socket.on('call:answer', (p = {}) => { relayCall('call:answer', { ...p, sdp: p.sdp || p.answer }, ['call:accepted']).catch(() => {}) })
  socket.on('call:ice', (p = {}) => { relayCall('call:ice', p, ['call:ice-candidate']).catch(() => {}) })
  socket.on('call:ice-candidate', (p = {}) => { relayCall('call:ice-candidate', p, ['call:ice']).catch(() => {}) })
  socket.on('call:connected', (p = {}) => { relayCall('call:connected', p).catch(() => {}) })
  socket.on('call:failed', (p = {}) => { relayCall('call:failed', p, ['call:ended']).catch(() => {}) })
  socket.on('call:ended', (p = {}) => { relayCall('call:ended', p).catch(() => {}) })
  socket.on('call:end', (p = {}) => { relayCall('call:ended', p).catch(() => {}) })
  socket.on('call:reject', (p = {}) => { relayCall('call:rejected', p, ['call:ended']).catch(() => {}) })
  socket.on('call:cancelled', (p = {}) => { relayCall('call:cancelled', p, ['call:ended']).catch(() => {}) })

  socket.on('disconnect', async () => {
    clearInterval(sessionTimer)
    const userId = socketUserMap.get(socket.id)
    socketUserMap.delete(socket.id)
    if (userId && onlineUsers.has(userId)) {
      const set = onlineUsers.get(userId)
      set.delete(socket.id)
      if (set.size === 0) {
        onlineUsers.delete(userId)
        inCall.delete(userId)
        if (!(await isUserOnline(userId))) {
          await broadcastPresenceFor(userId, false)
          await prisma.profile.updateMany({ where: { userId }, data: { lastSeen: new Date() } }).catch(() => {})
        }
      }
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

// Behind Caddy/nginx set SOCKET_HOST=127.0.0.1 so the port is not exposed publicly.
const HOST = process.env.SOCKET_HOST || '0.0.0.0'
server.listen(PORT, HOST, () => {
  console.log(`FriendConnect realtime on ${HOST}:${PORT}`)
})

process.on('SIGTERM', async () => {
  await prisma.$disconnect()
  server.close(() => process.exit(0))
})
