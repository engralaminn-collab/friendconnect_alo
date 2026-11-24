import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { asyncRoute, badRequest, forbidden, notFound } from './errors.js';
import { authenticate, clearSessionCookie, requireAdmin, requireCsrf, setSessionCookie } from './middleware.js';
import { createUploadMiddleware } from './upload.js';

const uuid = z.string().uuid();
const token = z.string().regex(/^[A-Za-z0-9_-]{40,64}$/);
const email = z.string().email().max(254);
const nonEmpty = z.string().trim().min(1);

function parse(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) throw badRequest('INVALID_INPUT');
  return result.data;
}

function limiter(windowMs, max) {
  return rateLimit({
    windowMs,
    limit: max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, _res, next) => next(Object.assign(new Error('RATE_LIMITED'), { status: 429, code: 'RATE_LIMITED' })),
  });
}

export function createApiRouter({
  authService,
  chatService,
  chatRepository,
  callService,
  notificationService,
  mediaService,
  pool,
  config,
}) {
  const router = Router();
  const auth = authenticate(authService, config);
  const csrf = requireCsrf(config);
  const upload = createUploadMiddleware(mediaService);
  const authRate = limiter(15 * 60 * 1000, 300);
  const loginRate = limiter(15 * 60 * 1000, 10);
  const registrationRate = limiter(60 * 60 * 1000, 5);
  const emailRate = limiter(15 * 60 * 1000, 5);

  router.use(authRate);
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  router.post('/auth/register', registrationRate, asyncRoute(async (req, res) => {
    const input = parse(z.object({
      inviteToken: token,
      email,
      username: z.string().min(3).max(32),
      displayName: z.string().min(1).max(80),
      password: z.string().min(12).max(128),
    }).strict(), req.body);
    await authService.register(input);
    res.status(202).json({ verificationRequired: true });
  }));

  router.post('/auth/verify-email', emailRate, asyncRoute(async (req, res) => {
    const input = parse(z.object({ token }).strict(), req.body);
    res.json(await authService.verifyEmail(input.token));
  }));

  router.post('/auth/verification/resend', emailRate, asyncRoute(async (req, res) => {
    const input = parse(z.object({ email, password: z.string().min(1).max(128) }).strict(), req.body);
    res.status(202).json(await authService.resendVerification(input));
  }));

  router.post('/auth/password-reset/request', emailRate, asyncRoute(async (req, res) => {
    const input = parse(z.object({ email }).strict(), req.body);
    res.status(202).json(await authService.requestPasswordReset(input.email));
  }));

  router.post('/auth/password-reset/confirm', emailRate, asyncRoute(async (req, res) => {
    const input = parse(z.object({ token, password: z.string().min(12).max(128) }).strict(), req.body);
    res.json(await authService.resetPassword(input));
  }));

  router.post('/auth/login', loginRate, asyncRoute(async (req, res) => {
    const input = parse(z.object({
      email,
      password: z.string().min(1).max(128),
      clientType: z.enum(['web', 'mobile']).default('web'),
    }).strict(), req.body);
    const session = await authService.login({
      ...input,
      userAgent: req.get('user-agent'),
    });
    if (input.clientType === 'web') {
      setSessionCookie(res, config, session);
      const { sessionToken: _privateToken, ...body } = session;
      res.json(body);
    } else {
      const { sessionToken, ...body } = session;
      res.json({ ...body, accessToken: sessionToken, tokenType: 'Bearer' });
    }
  }));

  router.get('/auth/session', auth, asyncRoute(async (req, res) => {
    res.json({
      user: req.auth.user,
      expiresAt: req.auth.expiresAt,
      csrfToken: req.auth.authMethod === 'cookie' ? authService.csrfForSession(req.auth.sessionToken) : undefined,
    });
  }));

  router.post('/auth/logout', auth, csrf, asyncRoute(async (req, res) => {
    await authService.logout(req.auth);
    clearSessionCookie(res, config);
    res.status(204).end();
  }));

  router.post('/auth/logout-all', auth, csrf, asyncRoute(async (req, res) => {
    const result = await authService.logoutAll(req.auth);
    clearSessionCookie(res, config);
    res.json(result);
  }));

  router.get('/admin/invites', auth, requireAdmin, asyncRoute(async (req, res) => {
    res.json({ invites: await authService.listInvites(req.auth.user) });
  }));

  router.post('/admin/invites', auth, csrf, requireAdmin, asyncRoute(async (req, res) => {
    const input = parse(z.object({
      email: email.nullable().optional(),
      expiresInHours: z.number().int().min(1).max(720).default(168),
    }).strict(), req.body);
    res.status(201).json(await authService.createInvite(req.auth.user, input));
  }));

  router.delete('/admin/invites/:inviteId', auth, csrf, requireAdmin, asyncRoute(async (req, res) => {
    const inviteId = parse(uuid, req.params.inviteId);
    if (!await authService.revokeInvite(req.auth.user, inviteId)) throw notFound('INVITE_NOT_REVOCABLE');
    res.status(204).end();
  }));

  router.get('/admin/users', auth, requireAdmin, asyncRoute(async (req, res) => {
    const query = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 64) : '';
    const users = await authService.listUsers(req.auth.user, query, Number(req.query.limit) || 50);
    res.json({ users });
  }));

  router.patch('/admin/users/:userId/status', auth, csrf, requireAdmin, asyncRoute(async (req, res) => {
    const userId = parse(uuid, req.params.userId);
    const { status } = parse(z.object({ status: z.enum(['active', 'suspended']) }).strict(), req.body);
    const changed = await authService.suspendUser(req.auth.user, userId, status === 'suspended');
    if (!changed) throw notFound('USER_NOT_SUSPENDABLE');
    res.json({ userId, status });
  }));

  router.get('/users/search', auth, asyncRoute(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    res.json({ users: await chatService.searchUsers(req.auth.user.id, q, Number(req.query.limit) || 20) });
  }));

  router.get('/friends', auth, asyncRoute(async (req, res) => {
    res.json({ friends: await chatRepository.listFriends(req.auth.user.id) });
  }));

  router.get('/friends/requests', auth, asyncRoute(async (req, res) => {
    res.json({ requests: await chatRepository.listFriendRequests(req.auth.user.id) });
  }));

  router.post('/friends/requests', auth, csrf, asyncRoute(async (req, res) => {
    const { targetId } = parse(z.object({ targetId: uuid }).strict(), req.body);
    res.status(201).json(await chatService.requestFriend(req.auth.user.id, targetId));
  }));

  router.post('/friends/requests/:userId/accept', auth, csrf, asyncRoute(async (req, res) => {
    const otherUserId = parse(uuid, req.params.userId);
    res.json(await chatService.acceptFriendRequest(req.auth.user.id, otherUserId));
  }));

  router.delete('/friends/:userId', auth, csrf, asyncRoute(async (req, res) => {
    const otherUserId = parse(uuid, req.params.userId);
    res.json(await chatService.removeFriend(req.auth.user.id, otherUserId));
  }));

  router.post('/blocks/:userId', auth, csrf, asyncRoute(async (req, res) => {
    const targetId = parse(uuid, req.params.userId);
    res.json(await chatService.blockUser(req.auth.user.id, targetId));
  }));

  router.get('/conversations', auth, asyncRoute(async (req, res) => {
    res.json({ conversations: await chatService.listConversations(req.auth.user.id) });
  }));

  router.post('/conversations/direct', auth, csrf, asyncRoute(async (req, res) => {
    const { userId } = parse(z.object({ userId: uuid }).strict(), req.body);
    res.status(201).json(await chatService.createDirectConversation(req.auth.user.id, userId));
  }));

  router.post('/conversations/group', auth, csrf, asyncRoute(async (req, res) => {
    const input = parse(z.object({
      name: z.string().trim().min(1).max(80),
      memberIds: z.array(uuid).min(2).max(29),
    }).strict(), req.body);
    res.status(201).json(await chatService.createGroupConversation(req.auth.user.id, input));
  }));

  router.get('/conversations/:conversationId/messages', auth, asyncRoute(async (req, res) => {
    const conversationId = parse(uuid, req.params.conversationId);
    const beforeId = req.query.beforeId ? parse(uuid, req.query.beforeId) : undefined;
    const beforeCreatedAt = req.query.beforeCreatedAt ? new Date(String(req.query.beforeCreatedAt)) : undefined;
    if (Boolean(beforeId) !== Boolean(beforeCreatedAt) || (beforeCreatedAt && Number.isNaN(beforeCreatedAt.getTime()))) {
      throw badRequest('INVALID_CURSOR');
    }
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const result = await chatService.listMessages(req.auth.user.id, conversationId, {
      id: beforeId,
      createdAt: beforeCreatedAt,
    }, limit);
    res.json(result);
  }));

  router.post('/conversations/:conversationId/messages', auth, csrf, asyncRoute(async (req, res) => {
    const conversationId = parse(uuid, req.params.conversationId);
    const input = parse(z.object({
      kind: z.enum(['text', 'image', 'video', 'file', 'audio']).default('text'),
      body: z.string().max(10000).optional(),
      attachmentId: uuid.optional(),
      replyToId: uuid.optional(),
    }).strict(), req.body);
    res.status(201).json(await chatService.sendMessage(req.auth.user.id, { conversationId, ...input }));
  }));

  router.patch('/messages/:messageId', auth, csrf, asyncRoute(async (req, res) => {
    const messageId = parse(uuid, req.params.messageId);
    const { body } = parse(z.object({ body: nonEmpty.max(10000) }).strict(), req.body);
    res.json(await chatService.editMessage(req.auth.user.id, messageId, body));
  }));

  router.delete('/messages/:messageId', auth, csrf, asyncRoute(async (req, res) => {
    const messageId = parse(uuid, req.params.messageId);
    res.json(await chatService.deleteMessage(req.auth.user.id, messageId));
  }));

  router.post('/conversations/:conversationId/messages/:messageId/receipt', auth, csrf, asyncRoute(async (req, res) => {
    const conversationId = parse(uuid, req.params.conversationId);
    const messageId = parse(uuid, req.params.messageId);
    const { status } = parse(z.object({ status: z.enum(['delivered', 'seen']) }).strict(), req.body);
    res.json(await chatService.markReceipt(req.auth.user.id, { conversationId, messageId }, status));
  }));

  router.post('/conversations/:conversationId/messages/:messageId/reactions', auth, csrf, asyncRoute(async (req, res) => {
    const conversationId = parse(uuid, req.params.conversationId);
    const messageId = parse(uuid, req.params.messageId);
    const input = parse(z.object({ emoji: z.string().min(1).max(16), active: z.boolean() }).strict(), req.body);
    res.json(await chatService.setReaction(req.auth.user.id, { conversationId, messageId, ...input }));
  }));

  router.get('/conversations/:conversationId/calls/active', auth, asyncRoute(async (req, res) => {
    const conversationId = parse(uuid, req.params.conversationId);
    const call = await callService.currentCall(req.auth.user.id, conversationId);
    res.json({ call });
  }));

  router.get('/conversations/:conversationId/calls', auth, asyncRoute(async (req, res) => {
    const conversationId = parse(uuid, req.params.conversationId);
    res.json({ calls: await callService.history(req.auth.user.id, conversationId, Number(req.query.limit) || 25) });
  }));

  router.post('/rtc/turn-credentials', auth, csrf, asyncRoute(async (req, res) => {
    res.json(await callService.issueTurnCredentials(req.auth.user.id));
  }));

  router.post('/conversations/:conversationId/attachments', auth, csrf, asyncRoute(async (req, _res, next) => {
    const conversationId = parse(uuid, req.params.conversationId);
    if (!await chatRepository.isConversationMember(conversationId, req.auth.user.id)) throw forbidden('NOT_A_MEMBER');
    req.conversationId = conversationId;
    next();
  }), upload, asyncRoute(async (req, res) => {
    if (!req.file) throw badRequest('FILE_REQUIRED');
    const attachment = await mediaService.storeUpload(req.auth.user.id, req.conversationId, req.file);
    res.status(201).json({ attachment });
  }));

  router.get('/attachments/:attachmentId', auth, asyncRoute(async (req, res) => {
    const attachmentId = parse(uuid, req.params.attachmentId);
    const { attachment, absolutePath } = await mediaService.openDownload(req.auth.user.id, attachmentId);
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Cache-Control', 'private, no-store');
    res.set('Content-Length', String(attachment.byteSize));
    res.attachment(attachment.originalName);
    res.type(attachment.detectedMime);
    await pipeline(createReadStream(absolutePath), res);
  }));

  router.get('/notifications', auth, asyncRoute(async (req, res) => {
    const hasBeforeId = Boolean(req.query.beforeId);
    const hasBeforeCreatedAt = Boolean(req.query.beforeCreatedAt);
    const cursor = hasBeforeId && hasBeforeCreatedAt
      ? { id: parse(uuid, req.query.beforeId), createdAt: new Date(String(req.query.beforeCreatedAt)) }
      : undefined;
    if (hasBeforeId !== hasBeforeCreatedAt || (cursor?.createdAt && Number.isNaN(cursor.createdAt.getTime()))) {
      throw badRequest('INVALID_CURSOR');
    }
    res.json({ notifications: await notificationService.list(req.auth.user.id, cursor, Number(req.query.limit) || 30) });
  }));

  router.post('/notifications/:notificationId/read', auth, csrf, asyncRoute(async (req, res) => {
    const notificationId = parse(uuid, req.params.notificationId);
    const result = await notificationService.markRead(req.auth.user.id, notificationId);
    res.json({ read: result });
  }));

  router.get('/notifications/vapid-public-key', auth, asyncRoute(async (_req, res) => {
    res.json({ publicKey: config.webPush.publicKey ?? null });
  }));

  router.post('/notifications/push-subscription', auth, csrf, asyncRoute(async (req, res) => {
    const input = parse(z.object({
      endpoint: z.string().url().max(2048),
      keys: z.object({ p256dh: z.string().min(30).max(200), auth: z.string().min(16).max(100) }).strict(),
    }).strict(), req.body);
    res.status(201).json(await notificationService.saveSubscription(req.auth.user.id, input));
  }));

  router.delete('/notifications/push-subscription', auth, csrf, asyncRoute(async (req, res) => {
    const { endpoint } = parse(z.object({ endpoint: z.string().url().max(2048) }).strict(), req.body);
    res.json(await notificationService.removeSubscription(req.auth.user.id, endpoint));
  }));

  router.get('/health/ready', asyncRoute(async (_req, res) => {
    await pool.query('SELECT 1 AS ready');
    res.json({ status: 'ready' });
  }));

  return router;
}
