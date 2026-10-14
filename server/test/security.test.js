import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readConfig } from '../src/config.js';
import { createAuthService } from '../src/services/auth.js';
import { createCallService } from '../src/services/calls.js';
import { hashPassword, validatePassword, verifyPassword } from '../src/security/passwords.js';
import { deriveCsrfToken, hashToken, newToken } from '../src/security/tokens.js';

const now = Date.parse('2026-10-15T00:00:00.000Z');

function makeAuthRepository() {
  const state = { invites: [], users: [], sessions: [], audits: [], verificationTokenHash: null };
  return {
    state,
    async createInvite(invite) { state.invites.push(invite); },
    async listInvites() { return state.invites; },
    async revokeInvite() { return true; },
    async registerUsingInvite(input) {
      if (state.invites[0]?.tokenHash.toString('hex') !== hashToken('invite-token-for-unit-test-with-thirty-two').toString('hex')) {
        return { error: 'INVALID_INVITE' };
      }
      if (input.tokenHash.toString('hex') !== state.invites[0].tokenHash.toString('hex')) return { error: 'INVALID_INVITE' };
      state.verificationTokenHash = input.verifyTokenHash;
      state.users.push({
        id: input.userId,
        email: input.email,
        username: input.username,
        displayName: input.displayName,
        role: 'member',
        status: 'pending_verification',
        emailVerifiedAt: null,
        passwordHash: input.passwordHash,
      });
      return { userId: input.userId };
    },
    async findUserByEmail(email) { return state.users.find((user) => user.email === email) ?? null; },
    async createSession(session) { state.sessions.push(session); },
    async consumeVerificationToken(tokenHash) {
      if (!state.verificationTokenHash || !state.verificationTokenHash.equals(tokenHash)) return null;
      const user = state.users[0];
      user.status = 'active';
      user.emailVerifiedAt = new Date(now);
      return user.id;
    },
    async clearFailedLogins() {},
    async recordFailedLogin() {},
    async audit(event) { state.audits.push(event); },
    async revokeSession() {},
    async revokeAllSessions() { return 1; },
    async createPasswordResetToken() { return null; },
    async resetPasswordWithToken() { return null; },
    async suspendUser() { return true; },
    async listUsers() { return []; },
  };
}

test('cryptographic session, invite, and CSRF tokens are distinct and high entropy', () => {
  const first = newToken();
  const second = newToken();
  assert.match(first, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first, second);
  assert.notDeepEqual(hashToken(first), Buffer.from(first));
  assert.equal(deriveCsrfToken(first, 'a-secret').length, 43);
  assert.notEqual(deriveCsrfToken(first, 'a-secret'), deriveCsrfToken(first, 'another-secret'));
});

test('password policy and hashes use Argon2id', async () => {
  assert.equal(validatePassword('short'), false);
  assert.equal(validatePassword('a-safe-passphrase-123'), true);
  const hash = await hashPassword('a-safe-passphrase-123');
  assert.match(hash, /^\$argon2id\$/);
  assert.equal(await verifyPassword(hash, 'a-safe-passphrase-123'), true);
  assert.equal(await verifyPassword(hash, 'wrong-password'), false);
});

test('production config fails closed until deployment values are explicitly supplied', () => {
  assert.throws(() => readConfig({ NODE_ENV: 'production' }), /Production configuration is incomplete/);
  const dev = readConfig({ NODE_ENV: 'test' });
  assert.equal(dev.port, 3210);
  assert.equal(dev.isProduction, false);
});

test('invite registration consumes a token hash, then email verification unlocks login', async () => {
  const repository = makeAuthRepository();
  const mail = { verification: [], async sendVerification(message) { mail.verification.push(message); } };
  const config = { sessionTtlDays: 30, csrfSecret: 'test-csrf-secret-with-more-than-32-characters' };
  const service = await createAuthService({ repository, mailer: mail, config, now: () => now, logger: { error() {} } });
  const inviteToken = 'invite-token-for-unit-test-with-thirty-two';
  repository.state.invites.push({ tokenHash: hashToken(inviteToken) });

  const result = await service.register({
    inviteToken,
    email: 'Friend@example.test',
    username: 'Friend_One',
    displayName: 'Friend One',
    password: 'a-safe-passphrase-123',
  });
  assert.deepEqual(result, { verificationRequired: true });
  assert.equal(repository.state.users[0].email, 'friend@example.test');
  assert.equal(repository.state.users[0].username, 'friend_one');
  assert.match(repository.state.users[0].passwordHash, /^\$argon2id\$/);
  assert.equal(mail.verification.length, 1);
  assert.equal(repository.state.verificationTokenHash.equals(hashToken(mail.verification[0].token)), true);

  await assert.rejects(
    service.login({ email: 'friend@example.test', password: 'a-safe-passphrase-123', clientType: 'web' }),
    (error) => error.code === 'EMAIL_NOT_VERIFIED',
  );
  assert.deepEqual(await service.verifyEmail(mail.verification[0].token), { verified: true });
  const session = await service.login({ email: 'friend@example.test', password: 'a-safe-passphrase-123', clientType: 'web' });
  assert.equal(session.user.status, 'active');
  assert.match(session.sessionToken, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(repository.state.sessions[0].tokenHash.equals(hashToken(session.sessionToken)), true);
  assert.equal(typeof session.csrfToken, 'string');
});

test('Coturn REST credentials are HMAC-based and expire on the configured schedule', async () => {
  const secret = 'coturn-shared-secret-that-is-not-a-client-secret';
  const service = createCallService({
    repository: {},
    notificationService: {},
    gateway: {},
    turnConfig: {
      urls: ['stun:turn.example.test:3478', 'turn:turn.example.test:3478?transport=udp', 'turns:turn.example.test:5349?transport=tcp'],
      sharedSecret: secret,
      credentialTtlSeconds: 600,
    },
    now: () => now,
  });
  const config = await service.issueTurnCredentials('11111111-1111-4111-8111-111111111111');
  const expectedExpiry = Math.floor(now / 1000) + 600;
  const expectedUsername = `${expectedExpiry}:11111111-1111-4111-8111-111111111111`;
  const expectedCredential = createHmac('sha1', secret).update(expectedUsername).digest('base64');
  assert.equal(config.iceServers.length, 2);
  assert.deepEqual(config.iceServers[0], { urls: ['stun:turn.example.test:3478'] });
  assert.equal(config.iceServers[1].username, expectedUsername);
  assert.equal(config.iceServers[1].credential, expectedCredential);
  assert.equal(new Date(config.expiresAt).getTime(), expectedExpiry * 1000);
});
