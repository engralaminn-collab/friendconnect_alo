// Socket.IO real-time chat service for FriendConnect
// Port: 3003 (must match the XTransformPort used by the frontend)
//
// Auth: client passes `token` in handshake.auth or query, which is a
// short-lived HMAC-signed token issued by /api/auth/ws-token.

import { createServer } from "http"
import { Server } from "socket.io"
import crypto from "crypto"
import { PrismaClient } from "@prisma/client"

const PORT = Number(process.env.CHAT_SERVICE_PORT) || 3003
const SECRET = process.env.NEXTAUTH_SECRET || "friendconnect-dev-secret-change-in-production"
const db = new PrismaClient()

interface DecodedToken {
  uid: string
  username: string
  exp: number
}

function verifyToken(raw: string | undefined): DecodedToken | null {
  if (!raw) return null
  const parts = raw.split(".")
  if (parts.length !== 2) return null
  const [payloadB64, sig] = parts
  const expected = crypto.createHmac("sha256", SECRET).update(payloadB64).digest("base64url")
  // constant-time-ish compare
  if (expected.length !== sig.length) return null
  let diff = 0
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i)
  if (diff !== 0) return null
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as DecodedToken
    if (payload.exp < Date.now()) return null
    return payload
  } catch {
    return null
  }
}

const io = new Server(
  createServer(),
  {
    path: "/",
    cors: { origin: "*", methods: ["GET", "POST"] },
    pingTimeout: 60000,
    pingInterval: 25000,
  }
)

// Track online users: userId -> Set<socketId>
const onlineSockets = new Map<string, Set<string>>()

async function joinUserRooms(socket: any, userId: string) {
  // personal room
  await socket.join(`user:${userId}`)
  // all conversations the user is a member of
  const memberships = await db.conversationMember.findMany({
    where: { userId },
    select: { conversationId: true },
  })
  for (const m of memberships) {
    await socket.join(`conv:${m.conversationId}`)
  }
}

async function broadcastPresence(userId: string, online: boolean) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, username: true, name: true, lastSeenAt: true },
  })
  if (!user) return
  // Notify all conversations this user is in
  const memberships = await db.conversationMember.findMany({
    where: { userId },
    select: { conversationId: true },
  })
  const presence = {
    userId,
    online,
    lastSeenAt: user.lastSeenAt.toISOString(),
  }
  for (const m of memberships) {
    io.to(`conv:${m.conversationId}`).emit("presence:update", presence)
  }
}

io.use(async (socket, next) => {
  const token = (socket.handshake.auth as any)?.token || (socket.handshake.query as any)?.token
  const decoded = verifyToken(token)
  if (!decoded) {
    return next(new Error("UNAUTHORIZED"))
  }
  socket.data.userId = decoded.uid
  socket.data.username = decoded.username
  await db.user.update({
    where: { id: decoded.uid },
    data: { lastSeenAt: new Date() },
  }).catch(() => {})
  next()
})

io.on("connection", (socket) => {
  const userId = socket.data.userId as string
  if (!userId) {
    socket.disconnect(true)
    return
  }
  // Track online
  if (!onlineSockets.has(userId)) onlineSockets.set(userId, new Set())
  onlineSockets.get(userId)!.add(socket.id)
  let wasOffline = onlineSockets.get(userId)!.size === 1
  joinUserRooms(socket, userId).then(async () => {
    if (wasOffline) await broadcastPresence(userId, true)
  })

  console.log(`[chat] ${userId} connected (socket ${socket.id})`)

  // Heartbeat — client emits every 30s; we bump lastSeenAt
  socket.on("presence:heartbeat", async () => {
    try {
      await db.user.update({
        where: { id: userId },
        data: { lastSeenAt: new Date() },
      })
    } catch {}
  })

  // Join a conversation room on demand (used when opening a chat)
  socket.on("conversation:join", async (convId: string) => {
    if (typeof convId !== "string") return
    const m = await db.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId: convId, userId } },
      select: { conversationId: true },
    }).catch(() => null)
    if (m) await socket.join(`conv:${convId}`)
  })

  // Send a message
  socket.on("message:send", async (payload: any, ack?: (res: any) => void) => {
    try {
      const conversationId = String(payload?.conversationId || "")
      const content = String(payload?.content || "").trim()
      const replyToId = payload?.replyToId ? String(payload.replyToId) : null
      const attachmentIds: string[] = Array.isArray(payload?.attachmentIds) ? payload.attachmentIds : []
      if (!conversationId || (!content && attachmentIds.length === 0)) {
        if (ack) ack({ error: "INVALID" })
        return
      }
      const membership = await db.conversationMember.findUnique({
        where: { conversationId_userId: { conversationId, userId } },
      })
      if (!membership) {
        if (ack) ack({ error: "FORBIDDEN" })
        return
      }
      const msg = await db.message.create({
        data: {
          conversationId,
          senderId: userId,
          content,
          replyToId,
          ...(attachmentIds.length ? { attachments: { connect: attachmentIds.map((id) => ({ id })) } } : {}),
        },
        include: {
          sender: { select: { id: true, username: true, name: true, avatarUrl: true } },
          attachments: true,
          reactions: { include: { user: { select: { id: true, username: true } } } },
          reads: { select: { userId: true, readAt: true } },
          replyTo: { select: { id: true, content: true, senderId: true, sender: { select: { username: true, name: true } } } },
        },
      })
      // bump conversation updatedAt
      await db.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } })
      // broadcast to the conversation room (includes sender's other sockets)
      io.to(`conv:${conversationId}`).emit("message:new", { conversationId, message: msg })
      // notify other members personally (for inbox badge) if they're not in the room
      const members = await db.conversationMember.findMany({
        where: { userId: { not: userId } },
        select: { userId: true },
      })
      for (const m of members) {
        // Create a notification only for direct conversations to keep noise low
        // (For groups, the unread badge will surface via the conversation list.)
      }
      if (ack) ack({ ok: true, message: msg })
    } catch (e: any) {
      console.error("[message:send] error", e)
      if (ack) ack({ error: "SERVER" })
    }
  })

  // Edit a message
  socket.on("message:edit", async (payload: any, ack?: (res: any) => void) => {
    try {
      const messageId = String(payload?.messageId || "")
      const content = String(payload?.content || "").trim()
      if (!messageId || !content) {
        if (ack) ack({ error: "INVALID" })
        return
      }
      const msg = await db.message.findUnique({ where: { id: messageId }, select: { id: true, senderId: true, conversationId: true } })
      if (!msg || msg.senderId !== userId) {
        if (ack) ack({ error: "FORBIDDEN" })
        return
      }
      const updated = await db.message.update({
        where: { id: messageId },
        data: { content, editedAt: new Date() },
        include: {
          sender: { select: { id: true, username: true, name: true, avatarUrl: true } },
          attachments: true,
          reactions: { include: { user: { select: { id: true, username: true } } } },
          reads: { select: { userId: true, readAt: true } },
        },
      })
      io.to(`conv:${msg.conversationId}`).emit("message:updated", { conversationId: msg.conversationId, message: updated })
      if (ack) ack({ ok: true, message: updated })
    } catch (e) {
      console.error("[message:edit] error", e)
      if (ack) ack({ error: "SERVER" })
    }
  })

  // Delete a message (for everyone if sender, scope=all)
  socket.on("message:delete", async (payload: any, ack?: (res: any) => void) => {
    try {
      const messageId = String(payload?.messageId || "")
      const scope = payload?.scope === "all" ? "all" : "self"
      const msg = await db.message.findUnique({ where: { id: messageId }, select: { id: true, senderId: true, conversationId: true } })
      if (!msg) {
        if (ack) ack({ error: "NOT_FOUND" })
        return
      }
      if (scope === "all") {
        if (msg.senderId !== userId) {
          if (ack) ack({ error: "FORBIDDEN" })
          return
        }
        await db.message.update({ where: { id: messageId }, data: { deletedForAll: true, content: "" } })
        io.to(`conv:${msg.conversationId}`).emit("message:deleted", { conversationId: msg.conversationId, messageId, deletedForAll: true })
      }
      if (ack) ack({ ok: true })
    } catch (e) {
      console.error("[message:delete] error", e)
      if (ack) ack({ error: "SERVER" })
    }
  })

  // Toggle reaction
  socket.on("message:react", async (payload: any, ack?: (res: any) => void) => {
    try {
      const messageId = String(payload?.messageId || "")
      const emoji = String(payload?.emoji || "").slice(0, 8)
      if (!messageId || !emoji) {
        if (ack) ack({ error: "INVALID" })
        return
      }
      const msg = await db.message.findUnique({ where: { id: messageId }, select: { id: true, conversationId: true } })
      if (!msg) {
        if (ack) ack({ error: "NOT_FOUND" })
        return
      }
      const membership = await db.conversationMember.findUnique({
        where: { conversationId_userId: { conversationId: msg.conversationId, userId } },
      })
      if (!membership) {
        if (ack) ack({ error: "FORBIDDEN" })
        return
      }
      const existing = await db.messageReaction.findUnique({
        where: { messageId_userId_emoji: { messageId, userId, emoji } },
      })
      let action: "added" | "removed" = "added"
      if (existing) {
        await db.messageReaction.delete({ where: { id: existing.id } })
        action = "removed"
      } else {
        await db.messageReaction.create({ data: { messageId, userId, emoji } })
      }
      io.to(`conv:${msg.conversationId}`).emit("message:reaction", {
        conversationId: msg.conversationId,
        messageId,
        userId,
        emoji,
        action,
      })
      if (ack) ack({ ok: true, action })
    } catch (e) {
      console.error("[message:react] error", e)
      if (ack) ack({ error: "SERVER" })
    }
  })

  // Mark conversation as read
  socket.on("message:read", async (payload: any) => {
    try {
      const conversationId = String(payload?.conversationId || "")
      if (!conversationId) return
      const membership = await db.conversationMember.findUnique({
        where: { conversationId_userId: { conversationId, userId } },
      })
      if (!membership) return
      await db.conversationMember.update({
        where: { conversationId_userId: { conversationId, userId } },
        data: { lastReadAt: new Date() },
      })
      io.to(`conv:${conversationId}`).emit("message:read", { conversationId, userId })
    } catch {}
  })

  // Typing indicators — per-conversation timeout Map so typing in conv A
  // doesn't cancel the auto-expiry timer for conv B.
  const typingTimeouts = new Map<string, any>()
  const clearTypingTimeout = (convId: string) => {
    const t = typingTimeouts.get(convId)
    if (t) {
      clearTimeout(t)
      typingTimeouts.delete(convId)
    }
  }
  socket.on("typing:start", async (convId: string) => {
    if (typeof convId !== "string") return
    const m = await db.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId: convId, userId } },
    }).catch(() => null)
    if (!m) return
    socket.to(`conv:${convId}`).emit("typing:update", { conversationId: convId, userId, isTyping: true })
    clearTypingTimeout(convId)
    typingTimeouts.set(
      convId,
      setTimeout(() => {
        socket.to(`conv:${convId}`).emit("typing:update", { conversationId: convId, userId, isTyping: false })
        typingTimeouts.delete(convId)
      }, 4000)
    )
  })

  socket.on("typing:stop", async (convId: string) => {
    if (typeof convId !== "string") return
    socket.to(`conv:${convId}`).emit("typing:update", { conversationId: convId, userId, isTyping: false })
    clearTypingTimeout(convId)
  })

  // Disconnect
  socket.on("disconnect", async () => {
    // Clear all pending typing timeouts so other users don't see stuck indicators
    for (const t of typingTimeouts.values()) clearTimeout(t)
    typingTimeouts.clear()
    const set = onlineSockets.get(userId)
    if (set) {
      set.delete(socket.id)
      if (set.size === 0) {
        onlineSockets.delete(userId)
        await broadcastPresence(userId, false)
      }
    }
    console.log(`[chat] ${userId} disconnected (socket ${socket.id})`)
  })

  socket.on("error", (err: any) => console.error(`[chat] socket error (${socket.id}):`, err))
})

io.listen(PORT, () => {
  console.log(`[chat-service] Socket.IO listening on :${PORT}`)
})

process.on("SIGTERM", () => {
  console.log("[chat-service] SIGTERM, closing")
  io.close(() => process.exit(0))
})
process.on("SIGINT", () => {
  console.log("[chat-service] SIGINT, closing")
  io.close(() => process.exit(0))
})


// ============== Call signaling (1:1 WebRTC) ==============
io.on("connection", (socket) => {
  const userId = socket.data.userId
  if (!userId) return

  socket.on("call:offer", (payload: {
    toUserId: string; callId: string; callType: "audio" | "video"; offer: RTCSessionDescriptionInit
  }) => {
    if (!payload?.toUserId || !payload?.offer || !payload?.callId) return
    io.to(`user:${payload.toUserId}`).emit("call:incoming", {
      callId: payload.callId, callType: payload.callType, fromUserId: userId, offer: payload.offer,
    })
  })

  socket.on("call:answer", (payload: {
    toUserId: string; callId: string; answer: RTCSessionDescriptionInit
  }) => {
    if (!payload?.toUserId || !payload?.answer) return
    io.to(`user:${payload.toUserId}`).emit("call:accepted", {
      callId: payload.callId, fromUserId: userId, answer: payload.answer,
    })
  })

  socket.on("call:reject", (payload: { toUserId: string; callId: string }) => {
    if (!payload?.toUserId) return
    io.to(`user:${payload.toUserId}`).emit("call:rejected", {
      callId: payload.callId, fromUserId: userId,
    })
  })

  socket.on("call:ice-candidate", (payload: {
    toUserId: string; callId: string; candidate: RTCIceCandidateInit
  }) => {
    if (!payload?.toUserId || !payload?.candidate) return
    io.to(`user:${payload.toUserId}`).emit("call:ice-candidate", {
      callId: payload.callId, fromUserId: userId, candidate: payload.candidate,
    })
  })

  socket.on("call:end", (payload: { toUserId: string; callId: string }) => {
    if (!payload?.toUserId) return
    io.to(`user:${payload.toUserId}`).emit("call:ended", {
      callId: payload.callId, fromUserId: userId,
    })
  })

  socket.on("call:cancel", (payload: { toUserId: string; callId: string }) => {
    if (!payload?.toUserId) return
    io.to(`user:${payload.toUserId}`).emit("call:cancelled", {
      callId: payload.callId, fromUserId: userId,
    })
  })
})
