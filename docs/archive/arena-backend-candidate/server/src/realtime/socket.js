import { randomUUID } from 'node:crypto';
import cookie from 'cookie';
import { Server } from 'socket.io';
import { z } from 'zod';
import { hashToken } from '../security/tokens.js';

const uuidSchema = z.string().uuid();
const messageSchema = z.object({
  conversationId: uuidSchema,
  kind: z.enum(['text', 'image', 'video', 'file', 'audio']).default('text'),
  body: z.string().max(10000).optional(),
  attachmentId: uuidSchema.optional(),
  replyToId: uuidSchema.optional(),
}).strict();
const callStartSchema = z.object({ conversationId: uuidSchema, mediaType: z.enum(['audio', 'video']) }).strict();
const callIdSchema = z.object({ callId: uuidSchema }).strict();
const joinSchema = z.object({ conversationId: uuidSchema }).strict();
const typingSchema = z.object({ conversationId: uuidSchema, active: z.boolean() }).strict();
const receiptSchema = z.object({ conversationId: uuidSchema, messageId: uuidSchema }).strict();
const reactionSchema = z.object({
  conversationId: uuidSchema,
  messageId: uuidSchema,
  emoji: z.string().min(1).max(16),
  active: z.boolean(),
}).strict();
const signalSchema = z.object({
  callId: uuidSchema,
  kind: z.enum(['offer', 'answer', 'ice-candidate']),
  payload: z.unknown(),
}).strict();

function parseSignalPayload(kind, payload) {
  if (kind === 'offer' || kind === 'answer') {
    const parsed = z.object({ type: z.enum(['offer', 'answer']), sdp: z.string().min(1).max(65536) }).strict().safeParse(payload);
    if (!parsed.success || parsed.data.type !== kind) throw Object.assign(new Error('INVALID_SIGNAL'), { status: 400, code: 'INVALID_SIGNAL' });
    return parsed.data;
  }
  const parsed = z.object({
    candidate: z.string().max(4096),
    sdpMid: z.string().max(128).nullable().optional(),
    sdpMLineIndex: z.number().int().min(0).max(65535).nullable().optional(),
    usernameFragment: z.string().max(256).nullable().optional(),
  }).strict().safeParse(payload);
  if (!parsed.success) throw Object.assign(new Error('INVALID_SIGNAL'), { status: 400, code: 'INVALID_SIGNAL' });
  return parsed.data;
}

function getSessionToken(socket, cookieName) {
  const authorization = socket.handshake.headers.authorization;
  if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) {
    return authorization.slice(7).trim();
  }
  const cookies = cookie.parse(socket.handshake.headers.cookie ?? '');
  return cookies[cookieName];
}

function eventError(error) {
  return {
    code: typeof error?.code === 'string' ? error.code : (error?.name === 'ZodError' ? 'INVALID_INPUT' : 'INTERNAL_ERROR'),
    requestId: error?.requestId,
  };
}

export function createRealtimeGateway() {
  let io;
  const socketsByUser = new Map();
  const socketsBySession = new Map();
  const socketsByConversation = new Map();
  const userEventRateWindows = new Map();

  const keyForConversation = (conversationId) => `conversation:${conversationId}`;
  const keyForUser = (userId) => `user:${userId}`;

  function addToSetMap(map, key, value) {
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(value);
  }
  function removeFromSetMap(map, key, value) {
    const set = map.get(key);
    if (!set) return 0;
    set.delete(value);
    if (!set.size) map.delete(key);
    return set.size;
  }

  return Object.freeze({
    attach(server, dependencies) {
      if (io) throw new Error('Realtime gateway is already attached.');
      const { authService, chatRepository, chatService, callService, config, logger = console } = dependencies;
      const allowOrigin = (origin, callback) => {
        if (!origin || config.corsOrigins.includes(origin)) return callback(null, true);
        return callback(new Error('Origin not allowed'));
      };
      io = new Server(server, {
        cors: { origin: allowOrigin, credentials: true },
        allowRequest: (request, callback) => {
          const origin = request.headers.origin;
          callback(null, !origin || config.corsOrigins.includes(origin));
        },
        maxHttpBufferSize: 128 * 1024,
        pingInterval: 25000,
        pingTimeout: 20000,
        transports: ['websocket', 'polling'],
      });

      io.use(async (socket, next) => {
        try {
          const token = getSessionToken(socket, config.sessionCookieName);
          socket.data.auth = await authService.authenticateSessionToken(token);
          socket.data.sessionToken = token;
          socket.data.requestId = randomUUID();
          next();
        } catch {
          next(new Error('unauthorized'));
        }
      });

      io.on('connection', (socket) => {
        const userId = socket.data.auth.user.id;
        const sessionToken = socket.data.sessionToken;
        addToSetMap(socketsByUser, userId, socket.id);
        addToSetMap(socketsBySession, hashToken(sessionToken).toString('hex'), socket.id);
        socket.data.conversations = new Set();
        socket.join(keyForUser(userId));

        socket.use((packet, next) => {
          authService.authenticateSessionToken(socket.data.sessionToken)
            .then((freshAuth) => {
              socket.data.auth = freshAuth;
              next();
            })
            .catch(() => {
              socket.disconnect(true);
              next(new Error('unauthorized'));
            });
        });

        const allowEvent = (eventName, maximum, windowMs = 60000) => {
          const now = Date.now();
          const userId = socket.data.auth.user.id;
          const key = `${userId}:${eventName}`;
          const previous = userEventRateWindows.get(key);
          const current = !previous || now - previous.startedAt >= windowMs
            ? { startedAt: now, count: 0 }
            : previous;
          current.count += 1;
          userEventRateWindows.set(key, current);
          if (current.count > maximum) {
            throw Object.assign(new Error('RATE_LIMITED'), { status: 429, code: 'RATE_LIMITED' });
          }
        };

        const receive = (eventName, handler, options = {}) => {
          socket.on(eventName, (payload, acknowledge) => {
            Promise.resolve().then(async () => {
              allowEvent(eventName, options.maximum ?? 120, options.windowMs);
              const result = await handler(socket.data.auth, payload ?? {}, socket);
              if (typeof acknowledge === 'function') acknowledge({ ok: true, data: result ?? null });
            }).catch((error) => {
              if (typeof acknowledge === 'function') acknowledge({ ok: false, error: eventError(error) });
              if (error?.name !== 'ZodError' && (error?.status >= 500 || !error?.status)) {
                logger.error?.({ code: error?.code, requestId: socket.data.requestId, eventName }, 'Realtime event failed');
              }
            });
          });
        };

        receive('conversation:join', async (auth, raw, currentSocket) => {
          const input = joinSchema.parse(raw);
          if (!await chatRepository.isConversationMember(input.conversationId, auth.user.id)) {
            throw Object.assign(new Error('NOT_A_MEMBER'), { status: 403, code: 'NOT_A_MEMBER' });
          }
          const room = keyForConversation(input.conversationId);
          currentSocket.join(room);
          currentSocket.data.conversations.add(input.conversationId);
          if (!socketsByConversation.has(input.conversationId)) socketsByConversation.set(input.conversationId, new Map());
          const roomUsers = socketsByConversation.get(input.conversationId);
          addToSetMap(roomUsers, auth.user.id, currentSocket.id);
          const onlineUserIds = [...roomUsers.keys()];
          currentSocket.emit('presence:snapshot', { conversationId: input.conversationId, onlineUserIds });
          currentSocket.to(room).emit('presence:update', { conversationId: input.conversationId, userId: auth.user.id, online: true });
          return { joined: true };
        }, { maximum: 60 });

        receive('conversation:leave', async (_auth, raw, currentSocket) => {
          const input = joinSchema.parse(raw);
          const room = keyForConversation(input.conversationId);
          currentSocket.leave(room);
          currentSocket.data.conversations.delete(input.conversationId);
          const roomUsers = socketsByConversation.get(input.conversationId);
          if (roomUsers) {
            const remaining = removeFromSetMap(roomUsers, socket.data.auth.user.id, currentSocket.id);
            if (!remaining) {
              currentSocket.to(room).emit('presence:update', { conversationId: input.conversationId, userId: socket.data.auth.user.id, online: false });
            }
            if (!roomUsers.size) socketsByConversation.delete(input.conversationId);
          }
          return { left: true };
        }, { maximum: 60 });

        receive('typing:update', async (auth, raw, currentSocket) => {
          const input = typingSchema.parse(raw);
          if (!await chatRepository.isConversationMember(input.conversationId, auth.user.id)) {
            throw Object.assign(new Error('NOT_A_MEMBER'), { status: 403, code: 'NOT_A_MEMBER' });
          }
          currentSocket.to(keyForConversation(input.conversationId)).emit('typing:update', {
            conversationId: input.conversationId,
            userId: auth.user.id,
            active: input.active,
          });
          return { delivered: true };
        }, { maximum: 60 });

        receive('message:send', async (auth, raw) => {
          const input = messageSchema.parse(raw);
          return chatService.sendMessage(auth.user.id, input);
        }, { maximum: 40 });

        receive('message:delivered', async (auth, raw) => {
          const input = receiptSchema.parse(raw);
          return chatService.markReceipt(auth.user.id, input, 'delivered');
        }, { maximum: 120 });

        receive('message:seen', async (auth, raw) => {
          const input = receiptSchema.parse(raw);
          return chatService.markReceipt(auth.user.id, input, 'seen');
        }, { maximum: 120 });

        receive('message:reaction', async (auth, raw) => {
          const input = reactionSchema.parse(raw);
          return chatService.setReaction(auth.user.id, input);
        }, { maximum: 60 });

        receive('call:start', async (auth, raw) => callService.startCall(auth.user.id, callStartSchema.parse(raw)), { maximum: 5, windowMs: 60000 });
        receive('call:accept', async (auth, raw) => callService.transition(auth.user.id, callIdSchema.parse(raw).callId, 'accept'), { maximum: 10 });
        receive('call:decline', async (auth, raw) => callService.transition(auth.user.id, callIdSchema.parse(raw).callId, 'decline'), { maximum: 10 });
        receive('call:end', async (auth, raw) => callService.transition(auth.user.id, callIdSchema.parse(raw).callId, 'end'), { maximum: 20 });
        receive('call:signal', async (auth, raw) => {
          const input = signalSchema.parse(raw);
          const safePayload = parseSignalPayload(input.kind, input.payload);
          const peer = await callService.authorizeSignal(auth.user.id, input.callId);
          io.to(keyForUser(peer.peerId)).emit('call:signal', {
            callId: input.callId,
            fromUserId: auth.user.id,
            kind: input.kind,
            payload: safePayload,
          });
          return { relayed: true };
        }, { maximum: 120 });

        socket.on('disconnect', () => {
          const userRemaining = removeFromSetMap(socketsByUser, userId, socket.id);
          removeFromSetMap(socketsBySession, hashToken(sessionToken).toString('hex'), socket.id);
          for (const conversationId of socket.data.conversations) {
            const room = keyForConversation(conversationId);
            const roomUsers = socketsByConversation.get(conversationId);
            if (!roomUsers) continue;
            const remaining = removeFromSetMap(roomUsers, userId, socket.id);
            if (!remaining) socket.to(room).emit('presence:update', { conversationId, userId, online: false });
            if (!roomUsers.size) socketsByConversation.delete(conversationId);
          }
          if (!userRemaining) io.to(keyForUser(userId)).emit('presence:offline');
        });
      });

      return io;
    },

    emitToUser(userId, eventName, payload) {
      io?.to(keyForUser(userId)).emit(eventName, payload);
    },

    emitToConversation(conversationId, eventName, payload) {
      io?.to(keyForConversation(conversationId)).emit(eventName, payload);
    },

    disconnectUser(userId, reason = 'session revoked') {
      const socketIds = [...(socketsByUser.get(userId) ?? [])];
      for (const socketId of socketIds) {
        const socket = io?.sockets.sockets.get(socketId);
        if (!socket) continue;
        let finished = false;
        const disconnectAfterNotice = () => {
          if (finished) return;
          finished = true;
          socket.disconnect(true);
        };
        // Wait for the client to acknowledge the revocation notice, with a hard
        // timeout so an unresponsive socket can never keep a revoked session alive.
        socket.timeout(1200).emit('session:revoked', { reason }, disconnectAfterNotice);
      }
      return socketIds.length;
    },

    disconnectSession(sessionToken) {
      if (!sessionToken) return;
      const ids = socketsBySession.get(hashToken(sessionToken).toString('hex'));
      if (!ids) return;
      for (const socketId of [...ids]) io?.sockets.sockets.get(socketId)?.disconnect(true);
    },

    async close() {
      if (!io) return;
      await new Promise((resolve) => io.close(resolve));
      io = undefined;
    },
  });
}
