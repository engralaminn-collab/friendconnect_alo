import test from 'node:test';
import assert from 'node:assert/strict';
import pino from 'pino';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { deriveCsrfToken } from '../src/security/tokens.js';

const sessionToken = 'browser-session-token-for-tests-should-be-long-enough';
const csrfSecret = 'development-csrf-secret';
const csrfToken = deriveCsrfToken(sessionToken, csrfSecret);
const user = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'friend@example.test',
  username: 'friend_one',
  displayName: 'Friend One',
  role: 'member',
  status: 'active',
  emailVerifiedAt: new Date().toISOString(),
};

function makeApp(overrides = {}) {
  const authService = {
    async authenticateSessionToken(token) {
      if (token !== sessionToken) {
        const error = new Error('Unauthenticated');
        error.status = 401;
        error.code = 'UNAUTHENTICATED';
        throw error;
      }
      return { user, clientType: 'web', sessionToken: token, expiresAt: new Date(Date.now() + 60_000) };
    },
    async login() {
      return { user, sessionToken, csrfToken, expiresAt: new Date(Date.now() + 60_000) };
    },
    csrfForSession: () => csrfToken,
    async logout() { return { loggedOut: true }; },
    async logoutAll() { return { revoked: 1 }; },
    async register() { return { verificationRequired: true }; },
    async verifyEmail() { return { verified: true }; },
    async resendVerification() { return { accepted: true }; },
    async requestPasswordReset() { return { accepted: true }; },
    async resetPassword() { return { passwordReset: true }; },
    async createInvite() { return { inviteId: 'invite', token: 'one-time-token' }; },
    async listInvites() { return []; },
    async revokeInvite() { return true; },
    async listUsers() { return []; },
    async suspendUser() { return true; },
    ...overrides.authService,
  };
  const chatService = {
    async requestFriend() { return { status: 'pending' }; },
    async searchUsers() { return []; },
    async listConversations() { return []; },
    async listMessages() { return { messages: [], hasMore: false }; },
    async sendMessage(_userId, message) { return { id: 'message-id', ...message }; },
    async markReceipt() { return { updated: true }; },
    async setReaction() { return { active: true }; },
    async editMessage() { return { id: 'message-id' }; },
    async deleteMessage() { return { deleted: true }; },
    async createDirectConversation() { return { conversationId: 'conversation-id' }; },
    async createGroupConversation() { return { conversationId: 'conversation-id' }; },
    async acceptFriendRequest() { return { accepted: true }; },
    async removeFriend() { return { removed: true }; },
    async blockUser() { return { blocked: true }; },
    ...overrides.chatService,
  };
  const chatRepository = {
    async listFriends() { return []; },
    async listFriendRequests() { return []; },
    async isConversationMember() { return true; },
    ...overrides.chatRepository,
  };
  const callService = {
    async history() { return []; },
    async issueTurnCredentials() { return { iceServers: [] }; },
    ...overrides.callService,
  };
  const notificationService = {
    async list() { return []; },
    async markRead() { return true; },
    async saveSubscription() { return { subscribed: true }; },
    async removeSubscription() { return { removed: true }; },
    ...overrides.notificationService,
  };
  const mediaService = {
    maxUploadBytes: 1024 * 1024,
    quarantineRoot: '/tmp',
    async storeUpload() { return { id: 'attachment-id' }; },
    async openDownload() { return { attachment: { byteSize: 1, originalName: 'x.bin', detectedMime: 'application/octet-stream' }, absolutePath: '/tmp/x' }; },
    ...overrides.mediaService,
  };
  const pool = { async query() { return [[{ ready: 1 }], []]; }, ...overrides.pool };
  const config = {
    trustProxy: false,
    isProduction: false,
    corsOrigins: ['http://localhost:3000'],
    sessionCookieName: 'friendconnect_session',
    csrfSecret: 'development-csrf-secret',
    webPush: { publicKey: 'vapid-public' },
    ...overrides.config,
  };
  return createApp({
    config,
    logger: pino({ level: 'silent' }),
    authService,
    chatService,
    chatRepository,
    callService,
    notificationService,
    mediaService,
    pool,
  });
}

test('liveness endpoint does not depend on MySQL', async () => {
  const app = makeApp();
  const response = await request(app).get('/health/live').expect(200);
  assert.deepEqual(response.body, { status: 'live' });
  assert.equal(response.headers['cache-control'], 'no-store');
});

test('web login uses an HttpOnly SameSite cookie and never returns the bearer token', async () => {
  const response = await request(makeApp())
    .post('/api/auth/login')
    .set('Origin', 'http://localhost:3000')
    .send({ email: 'friend@example.test', password: 'a-secure-long-password', clientType: 'web' })
    .expect(200);

  assert.match(response.headers['set-cookie'][0], /HttpOnly/i);
  assert.match(response.headers['set-cookie'][0], /SameSite=Strict/i);
  assert.equal(response.body.sessionToken, undefined);
  assert.equal(response.body.accessToken, undefined);
  assert.equal(response.body.user.id, user.id);
});

test('mobile login returns an access token without setting a browser cookie', async () => {
  const response = await request(makeApp())
    .post('/api/auth/login')
    .set('Origin', 'http://localhost:3000')
    .send({ email: 'friend@example.test', password: 'a-secure-long-password', clientType: 'mobile' })
    .expect(200);
  assert.equal(response.body.accessToken, sessionToken);
  assert.equal(response.headers['set-cookie'], undefined);
});

test('cookie-authenticated mutations require a valid CSRF token', async () => {
  const app = makeApp();
  await request(app)
    .post('/api/friends/requests')
    .set('Cookie', `friendconnect_session=${sessionToken}`)
    .set('Origin', 'http://localhost:3000')
    .send({ targetId: '22222222-2222-4222-8222-222222222222' })
    .expect(403);

  const response = await request(app)
    .post('/api/friends/requests')
    .set('Cookie', `friendconnect_session=${sessionToken}`)
    .set('X-CSRF-Token', csrfToken)
    .set('Origin', 'http://localhost:3000')
    .send({ targetId: '22222222-2222-4222-8222-222222222222' })
    .expect(201);
  assert.deepEqual(response.body, { status: 'pending' });
});

test('unapproved origins are rejected before a public authentication route executes', async () => {
  let loginCalled = false;
  const app = makeApp({ authService: { async login() { loginCalled = true; return {}; } } });
  await request(app)
    .post('/api/auth/login')
    .set('Origin', 'https://attacker.example')
    .send({ email: 'friend@example.test', password: 'a-secure-long-password' })
    .expect(403);
  assert.equal(loginCalled, false);
});

test('conversation attachment uploads require membership before the multipart body is accepted', async () => {
  let uploadCalled = false;
  const app = makeApp({
    chatRepository: { async isConversationMember() { return false; } },
    mediaService: { async storeUpload() { uploadCalled = true; return {}; } },
  });
  await request(app)
    .post('/api/conversations/33333333-3333-4333-8333-333333333333/attachments')
    .set('Cookie', `friendconnect_session=${sessionToken}`)
    .set('X-CSRF-Token', csrfToken)
    .set('Origin', 'http://localhost:3000')
    .attach('file', Buffer.from('private data'), 'test.txt')
    .expect(403);
  assert.equal(uploadCalled, false);
});

test('Socket and REST bearer sessions are accepted without CSRF tokens', async () => {
  const app = makeApp();
  await request(app)
    .post('/api/friends/requests')
    .set('Authorization', `Bearer ${sessionToken}`)
    .send({ targetId: '22222222-2222-4222-8222-222222222222' })
    .expect(201);
});
