import { randomUUID } from 'node:crypto';
import { conflict, forbidden, unauthorized, unavailable, badRequest } from '../http/errors.js';
import { hashPassword, validatePassword, verifyPassword } from '../security/passwords.js';
import { deriveCsrfToken, hashToken, newToken } from '../security/tokens.js';

const normalizeEmail = (email) => email.trim().toLowerCase();
const usernamePattern = /^[a-zA-Z0-9_]{3,32}$/;
const tokenPattern = /^[A-Za-z0-9_-]{40,64}$/;
const safeUser = (user) => ({
  id: user.id,
  email: user.email,
  username: user.username,
  displayName: user.displayName,
  role: user.role,
  status: user.status,
  emailVerifiedAt: user.emailVerifiedAt,
  createdAt: user.createdAt,
});

function requireMailer(mailer) {
  if (!mailer) throw unavailable('EMAIL_NOT_CONFIGURED');
}

function logDeliveryFailure(logger, error, context) {
  logger.error?.({ code: error?.code, responseCode: error?.responseCode, ...context }, 'Email delivery failed');
}

export async function createAuthService({ repository, mailer, config, gateway, logger = console, now = () => Date.now() }) {
  const dummyPasswordHash = await hashPassword(`dummy-${newToken(32)}-FriendConnect`);

  return Object.freeze({
    async createInvite(admin, { email = null, expiresInHours = 168 }) {
      if (admin.role !== 'admin') throw forbidden('ADMIN_REQUIRED');
      if (!Number.isInteger(expiresInHours) || expiresInHours < 1 || expiresInHours > 720) {
        throw badRequest('INVALID_EXPIRY');
      }
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest('INVALID_EMAIL');
      if (email && !mailer) throw unavailable('EMAIL_NOT_CONFIGURED');
      const token = newToken();
      const inviteId = randomUUID();
      const expiresAt = new Date(now() + expiresInHours * 60 * 60 * 1000);
      await repository.createInvite({
        id: inviteId,
        tokenHash: hashToken(token),
        email: email ? normalizeEmail(email) : null,
        createdBy: admin.id,
        expiresAt,
      });
      if (email) {
        try {
          await mailer.sendInvite({ to: normalizeEmail(email), token, expiresAt });
          await repository.audit({ actorId: admin.id, action: 'invite.create', targetType: 'invite', targetId: inviteId });
          return { inviteId, email: normalizeEmail(email), expiresAt, deliveredByEmail: true };
        } catch (error) {
          await repository.revokeInvite(inviteId).catch(() => {});
          logDeliveryFailure(logger, error, { inviteId });
          throw unavailable('INVITE_EMAIL_FAILED');
        }
      }
      await repository.audit({ actorId: admin.id, action: 'invite.create', targetType: 'invite', targetId: inviteId });
      return { inviteId, email: null, expiresAt, deliveredByEmail: false, token };
    },

    async listInvites(admin) {
      if (admin.role !== 'admin') throw forbidden('ADMIN_REQUIRED');
      return repository.listInvites();
    },

    async revokeInvite(admin, inviteId) {
      if (admin.role !== 'admin') throw forbidden('ADMIN_REQUIRED');
      const revoked = await repository.revokeInvite(inviteId);
      if (revoked) await repository.audit({ actorId: admin.id, action: 'invite.revoke', targetType: 'invite', targetId: inviteId });
      return revoked;
    },

    async register({ inviteToken, email, username, displayName, password }) {
      requireMailer(mailer);
      if (!tokenPattern.test(inviteToken ?? '')) throw badRequest('INVALID_INVITE');
      const normalizedEmail = normalizeEmail(email ?? '');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || normalizedEmail.length > 254) {
        throw badRequest('INVALID_EMAIL');
      }
      if (!usernamePattern.test(username ?? '')) throw badRequest('INVALID_USERNAME');
      if (typeof displayName !== 'string' || displayName.trim().length < 1 || displayName.trim().length > 80) {
        throw badRequest('INVALID_DISPLAY_NAME');
      }
      if (!validatePassword(password)) throw badRequest('WEAK_PASSWORD');

      const userId = randomUUID();
      const verificationToken = newToken();
      const passwordHash = await hashPassword(password);
      const verifyExpiresAt = new Date(now() + 24 * 60 * 60 * 1000);
      let result;
      try {
        result = await repository.registerUsingInvite({
          tokenHash: hashToken(inviteToken),
          email: normalizedEmail,
          username: username.toLowerCase(),
          displayName: displayName.trim(),
          passwordHash,
          userId,
          verifyTokenHash: hashToken(verificationToken),
          verifyExpiresAt,
        });
      } catch (error) {
        if (error?.code === 'ER_DUP_ENTRY') throw conflict('ACCOUNT_ALREADY_EXISTS');
        throw error;
      }
      if (result.error === 'INVALID_INVITE') throw badRequest('INVALID_INVITE');
      if (result.error === 'INVITE_EMAIL_MISMATCH') throw badRequest('INVITE_EMAIL_MISMATCH');
      try {
        await mailer.sendVerification({ to: normalizedEmail, token: verificationToken });
      } catch (error) {
        logDeliveryFailure(logger, error, { userId });
        throw unavailable('VERIFICATION_EMAIL_FAILED');
      }
      await repository.audit({ action: 'account.register', targetType: 'user', targetId: userId });
      return { verificationRequired: true };
    },

    async verifyEmail(token) {
      if (!tokenPattern.test(token ?? '')) throw badRequest('INVALID_OR_EXPIRED_TOKEN');
      const userId = await repository.consumeVerificationToken(hashToken(token));
      if (!userId) throw badRequest('INVALID_OR_EXPIRED_TOKEN');
      await repository.audit({ action: 'account.verify_email', targetType: 'user', targetId: userId });
      return { verified: true };
    },

    async resendVerification({ email, password }) {
      if (!mailer) return { accepted: true };
      const normalizedEmail = normalizeEmail(typeof email === 'string' ? email : '');
      const looksLikeEmail = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(normalizedEmail);
      const user = looksLikeEmail ? await repository.findUserByEmail(normalizedEmail) : null;
      const valid = await verifyPassword(user?.passwordHash ?? dummyPasswordHash, typeof password === 'string' ? password : '');
      if (user && valid && user.status === 'pending_verification') {
        const token = newToken();
        const pending = await repository.createVerificationToken(
          user.id,
          hashToken(token),
          new Date(now() + 24 * 60 * 60 * 1000),
        );
        if (pending) {
          try {
            await mailer.sendVerification({ to: pending.email, token });
          } catch (error) {
            logDeliveryFailure(logger, error, { userId: user.id });
          }
        }
      }
      return { accepted: true };
    },

    async login({ email, password, clientType, userAgent }) {
      const normalizedEmail = normalizeEmail(typeof email === 'string' ? email : '');
      const user = normalizedEmail ? await repository.findUserByEmail(normalizedEmail) : null;
      const validPassword = await verifyPassword(user?.passwordHash ?? dummyPasswordHash, typeof password === 'string' ? password : '');
      if (!user || !validPassword) {
        if (user) await repository.recordFailedLogin(user.id);
        throw unauthorized('INVALID_CREDENTIALS');
      }
      if (user.loginLockedUntil && new Date(user.loginLockedUntil).getTime() > now()) {
        throw unauthorized('INVALID_CREDENTIALS');
      }
      if (user.status === 'pending_verification' || !user.emailVerifiedAt) {
        throw forbidden('EMAIL_NOT_VERIFIED');
      }
      if (user.status !== 'active') throw forbidden('ACCOUNT_DISABLED');
      await repository.clearFailedLogins(user.id);

      const token = newToken();
      const expiresAt = new Date(now() + config.sessionTtlDays * 24 * 60 * 60 * 1000);
      await repository.createSession({
        tokenHash: hashToken(token),
        userId: user.id,
        clientType,
        expiresAt,
        userAgent: typeof userAgent === 'string' ? userAgent : null,
      });
      await repository.audit({ actorId: user.id, action: 'session.create', targetType: 'session', metadata: { clientType } });
      return {
        user: safeUser(user),
        sessionToken: token,
        csrfToken: clientType === 'web' ? deriveCsrfToken(token, config.csrfSecret) : undefined,
        expiresAt,
      };
    },

    async authenticateSessionToken(token) {
      if (typeof token !== 'string' || !tokenPattern.test(token)) throw unauthorized();
      const session = await repository.findActiveSession(hashToken(token));
      if (!session) throw unauthorized();
      return {
        user: safeUser(session),
        clientType: session.clientType,
        sessionToken: token,
        expiresAt: session.expiresAt,
      };
    },

    csrfForSession(sessionToken) {
      return deriveCsrfToken(sessionToken, config.csrfSecret);
    },

    async logout(auth) {
      await repository.revokeSession(hashToken(auth.sessionToken), auth.user.id);
      gateway?.disconnectSession(auth.sessionToken);
      await repository.audit({ actorId: auth.user.id, action: 'session.revoke', targetType: 'session' });
      return { loggedOut: true };
    },

    async logoutAll(auth) {
      const revoked = await repository.revokeAllSessions(auth.user.id);
      gateway?.disconnectUser(auth.user.id, 'all sessions revoked');
      await repository.audit({ actorId: auth.user.id, action: 'session.revoke_all', targetType: 'user', targetId: auth.user.id });
      return { revoked };
    },

    async requestPasswordReset(email) {
      const normalizedEmail = normalizeEmail(typeof email === 'string' ? email : '');
      if (!mailer || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) return { accepted: true };
      const token = newToken();
      const user = await repository.createPasswordResetToken(
        normalizedEmail,
        hashToken(token),
        new Date(now() + 30 * 60 * 1000),
      );
      if (user) {
        try {
          await mailer.sendPasswordReset({ to: user.email, token });
        } catch (error) {
          logDeliveryFailure(logger, error, { userId: user.id });
        }
      }
      return { accepted: true };
    },

    async resetPassword({ token, password }) {
      if (!tokenPattern.test(token ?? '')) throw badRequest('INVALID_OR_EXPIRED_TOKEN');
      if (!validatePassword(password)) throw badRequest('WEAK_PASSWORD');
      const passwordHash = await hashPassword(password);
      const userId = await repository.resetPasswordWithToken(hashToken(token), passwordHash);
      if (!userId) throw badRequest('INVALID_OR_EXPIRED_TOKEN');
      gateway?.disconnectUser(userId, 'password reset');
      await repository.audit({ actorId: userId, action: 'account.password_reset', targetType: 'user', targetId: userId });
      return { passwordReset: true, sessionsRevoked: true };
    },

    async suspendUser(admin, targetId, suspended) {
      if (admin.role !== 'admin') throw forbidden('ADMIN_REQUIRED');
      if (targetId === admin.id) throw badRequest('CANNOT_SUSPEND_SELF');
      const changed = await repository.suspendUser(targetId, suspended);
      if (changed) {
        if (suspended) gateway?.disconnectUser(targetId, 'account suspended');
        await repository.audit({
          actorId: admin.id,
          action: suspended ? 'account.suspend' : 'account.unsuspend',
          targetType: 'user',
          targetId,
        });
      }
      return changed;
    },

    async listUsers(admin, query, limit) {
      if (admin.role !== 'admin') throw forbidden('ADMIN_REQUIRED');
      return repository.listUsers({ query, limit });
    },
  });
}
