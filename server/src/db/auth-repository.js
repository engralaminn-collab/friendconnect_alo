import { withTransaction } from './pool.js';

const safeUserColumns = `
  id, email, username, display_name AS displayName, role, status,
  email_verified_at AS emailVerifiedAt, created_at AS createdAt
`;

export class AuthRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async createInvite({ id, tokenHash, email, createdBy, expiresAt }) {
    await this.pool.execute(
      'INSERT INTO invites (id, token_hash, email, created_by, expires_at) VALUES (?, ?, ?, ?, ?)',
      [id, tokenHash, email, createdBy, expiresAt],
    );
  }

  async listInvites() {
    const [rows] = await this.pool.execute(`
      SELECT i.id, i.email, i.expires_at AS expiresAt, i.consumed_at AS consumedAt,
             i.revoked_at AS revokedAt, i.created_at AS createdAt,
             u.username AS createdByUsername
      FROM invites i JOIN users u ON u.id = i.created_by
      ORDER BY i.created_at DESC LIMIT 200
    `);
    return rows;
  }

  async revokeInvite(id) {
    const [result] = await this.pool.execute(
      `UPDATE invites SET revoked_at = UTC_TIMESTAMP(3)
       WHERE id = ? AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > UTC_TIMESTAMP(3)`,
      [id],
    );
    return result.affectedRows === 1;
  }

  async registerUsingInvite({ tokenHash, email, username, displayName, passwordHash, userId, verifyTokenHash, verifyExpiresAt }) {
    return withTransaction(this.pool, async (connection) => {
      const [invites] = await connection.execute(
        `SELECT id, email, expires_at AS expiresAt, consumed_at AS consumedAt, revoked_at AS revokedAt
         FROM invites WHERE token_hash = ? AND expires_at > UTC_TIMESTAMP(3) FOR UPDATE`,
        [tokenHash],
      );
      const invite = invites[0];
      if (!invite || invite.consumedAt || invite.revokedAt) {
        return { error: 'INVALID_INVITE' };
      }
      if (invite.email && invite.email.toLowerCase() !== email) return { error: 'INVITE_EMAIL_MISMATCH' };

      await connection.execute(
        `INSERT INTO users (id, email, username, display_name, password_hash, status)
         VALUES (?, ?, ?, ?, ?, 'pending_verification')`,
        [userId, email, username, displayName, passwordHash],
      );
      await connection.execute(
        'UPDATE invites SET consumed_at = UTC_TIMESTAMP(3), consumed_by = ? WHERE id = ?',
        [userId, invite.id],
      );
      await connection.execute(
        `INSERT INTO email_tokens (token_hash, user_id, purpose, expires_at)
         VALUES (?, ?, 'verify_email', ?)`,
        [verifyTokenHash, userId, verifyExpiresAt],
      );
      return { userId };
    });
  }

  async createAdmin({ id, email, username, displayName, passwordHash }) {
    const connection = await this.pool.getConnection();
    const lockName = 'friendconnect:self-hosted:bootstrap-admin';
    let locked = false;
    try {
      const [[lock]] = await connection.query('SELECT GET_LOCK(?, 15) AS acquired', [lockName]);
      if (lock?.acquired !== 1) throw new Error('Could not acquire the administrator bootstrap lock.');
      locked = true;
      const [admins] = await connection.execute("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
      if (admins.length) return false;
      const [result] = await connection.execute(
        `INSERT INTO users (id, email, username, display_name, password_hash, role, status, email_verified_at)
         VALUES (?, ?, ?, ?, ?, 'admin', 'active', UTC_TIMESTAMP(3))`,
        [id, email, username, displayName, passwordHash],
      );
      return result.affectedRows === 1;
    } finally {
      if (locked) await connection.query('SELECT RELEASE_LOCK(?)', [lockName]).catch(() => {});
      connection.release();
    }
  }

  async findUserByEmail(email) {
    const [rows] = await this.pool.execute(
      `SELECT ${safeUserColumns}, password_hash AS passwordHash,
              failed_login_count AS failedLoginCount, login_locked_until AS loginLockedUntil
       FROM users WHERE email = ? LIMIT 1`,
      [email],
    );
    return rows[0] ?? null;
  }

  async findUserById(id) {
    const [rows] = await this.pool.execute(`SELECT ${safeUserColumns} FROM users WHERE id = ? LIMIT 1`, [id]);
    return rows[0] ?? null;
  }

  async findActiveSession(tokenHash) {
    const [rows] = await this.pool.execute(`
      SELECT s.token_hash AS tokenHash, s.user_id AS userId, s.client_type AS clientType,
             s.expires_at AS expiresAt, u.id, u.email, u.username,
             u.display_name AS displayName, u.role, u.status,
             u.email_verified_at AS emailVerifiedAt
      FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.revoked_at IS NULL
        AND s.expires_at > UTC_TIMESTAMP(3)
        AND u.status = 'active' AND u.email_verified_at IS NOT NULL
      LIMIT 1
    `, [tokenHash]);
    const session = rows[0] ?? null;
    if (session) {
      await this.pool.execute(
        `UPDATE sessions SET last_seen_at = UTC_TIMESTAMP(3)
         WHERE token_hash = ? AND last_seen_at < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 5 MINUTE)`,
        [tokenHash],
      );
    }
    return session;
  }

  async createSession({ tokenHash, userId, clientType, expiresAt, userAgent }) {
    await this.pool.execute(
      `INSERT INTO sessions (token_hash, user_id, client_type, expires_at, user_agent)
       VALUES (?, ?, ?, ?, ?)`,
      [tokenHash, userId, clientType, expiresAt, userAgent?.slice(0, 512) ?? null],
    );
  }

  async revokeSession(tokenHash, userId) {
    const [result] = await this.pool.execute(
      `UPDATE sessions SET revoked_at = UTC_TIMESTAMP(3)
       WHERE token_hash = ? AND user_id = ? AND revoked_at IS NULL`,
      [tokenHash, userId],
    );
    return result.affectedRows > 0;
  }

  async revokeAllSessions(userId) {
    const [result] = await this.pool.execute(
      `UPDATE sessions SET revoked_at = UTC_TIMESTAMP(3)
       WHERE user_id = ? AND revoked_at IS NULL`,
      [userId],
    );
    return result.affectedRows;
  }

  async recordFailedLogin(userId) {
    await this.pool.execute(`
      UPDATE users
      SET login_locked_until = IF(
            login_fail_window_started_at IS NULL
            OR login_fail_window_started_at < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 15 MINUTE),
            NULL,
            IF(failed_login_count + 1 >= 5,
              DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 15 MINUTE),
              login_locked_until)
          ),
          failed_login_count = IF(
            login_fail_window_started_at IS NULL
            OR login_fail_window_started_at < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 15 MINUTE),
            1,
            failed_login_count + 1
          ),
          login_fail_window_started_at = IF(
            login_fail_window_started_at IS NULL
            OR login_fail_window_started_at < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 15 MINUTE),
            UTC_TIMESTAMP(3),
            login_fail_window_started_at
          )
      WHERE id = ?
    `, [userId]);
  }

  async clearFailedLogins(userId) {
    await this.pool.execute(
      'UPDATE users SET failed_login_count = 0, login_fail_window_started_at = NULL, login_locked_until = NULL WHERE id = ?',
      [userId],
    );
  }

  async consumeVerificationToken(tokenHash) {
    return withTransaction(this.pool, async (connection) => {
      const [rows] = await connection.execute(`
        SELECT user_id AS userId, expires_at AS expiresAt, consumed_at AS consumedAt
        FROM email_tokens WHERE token_hash = ? AND purpose = 'verify_email'
          AND expires_at > UTC_TIMESTAMP(3) FOR UPDATE
      `, [tokenHash]);
      const token = rows[0];
      if (!token || token.consumedAt) return null;
      const [result] = await connection.execute(
        `UPDATE users SET email_verified_at = UTC_TIMESTAMP(3), status = 'active'
         WHERE id = ? AND status = 'pending_verification' AND email_verified_at IS NULL`,
        [token.userId],
      );
      if (result.affectedRows !== 1) return null;
      await connection.execute('UPDATE email_tokens SET consumed_at = UTC_TIMESTAMP(3) WHERE token_hash = ?', [tokenHash]);
      return token.userId;
    });
  }

  async createVerificationToken(userId, tokenHash, expiresAt) {
    return withTransaction(this.pool, async (connection) => {
      const [rows] = await connection.execute(
        `SELECT email FROM users WHERE id = ? AND status = 'pending_verification'
         AND email_verified_at IS NULL FOR UPDATE`,
        [userId],
      );
      const user = rows[0];
      if (!user) return null;
      await connection.execute(
        `UPDATE email_tokens SET consumed_at = UTC_TIMESTAMP(3)
         WHERE user_id = ? AND purpose = 'verify_email' AND consumed_at IS NULL`,
        [userId],
      );
      await connection.execute(
        `INSERT INTO email_tokens (token_hash, user_id, purpose, expires_at)
         VALUES (?, ?, 'verify_email', ?)`,
        [tokenHash, userId, expiresAt],
      );
      return user;
    });
  }

  async createPasswordResetToken(email, tokenHash, expiresAt) {
    return withTransaction(this.pool, async (connection) => {
      const [users] = await connection.execute(
        `SELECT id, email FROM users WHERE email = ? AND status = 'active' AND email_verified_at IS NOT NULL LIMIT 1 FOR UPDATE`,
        [email],
      );
      const user = users[0];
      if (!user) return null;
      await connection.execute(
        `UPDATE email_tokens SET consumed_at = UTC_TIMESTAMP(3)
         WHERE user_id = ? AND purpose = 'reset_password' AND consumed_at IS NULL`,
        [user.id],
      );
      await connection.execute(
        `INSERT INTO email_tokens (token_hash, user_id, purpose, expires_at)
         VALUES (?, ?, 'reset_password', ?)`,
        [tokenHash, user.id, expiresAt],
      );
      return user;
    });
  }

  async resetPasswordWithToken(tokenHash, passwordHash) {
    return withTransaction(this.pool, async (connection) => {
      const [rows] = await connection.execute(`
        SELECT e.user_id AS userId, e.consumed_at AS consumedAt
        FROM email_tokens e JOIN users u ON u.id = e.user_id
        WHERE e.token_hash = ? AND e.purpose = 'reset_password'
          AND e.expires_at > UTC_TIMESTAMP(3) AND u.status = 'active'
        FOR UPDATE
      `, [tokenHash]);
      const token = rows[0];
      if (!token || token.consumedAt) return null;
      const [updated] = await connection.execute(
        `UPDATE users SET password_hash = ?, failed_login_count = 0,
         login_fail_window_started_at = NULL, login_locked_until = NULL WHERE id = ? AND status = 'active'`,
        [passwordHash, token.userId],
      );
      if (updated.affectedRows !== 1) return null;
      await connection.execute('UPDATE email_tokens SET consumed_at = UTC_TIMESTAMP(3) WHERE token_hash = ?', [tokenHash]);
      await connection.execute(
        `UPDATE email_tokens SET consumed_at = UTC_TIMESTAMP(3)
         WHERE user_id = ? AND purpose = 'reset_password' AND consumed_at IS NULL`,
        [token.userId],
      );
      await connection.execute(
        `UPDATE sessions SET revoked_at = UTC_TIMESTAMP(3)
         WHERE user_id = ? AND revoked_at IS NULL`,
        [token.userId],
      );
      return token.userId;
    });
  }

  async suspendUser(userId, suspended) {
    return withTransaction(this.pool, async (connection) => {
      const [result] = await connection.execute(
        `UPDATE users
         SET status = IF(? = 1, 'suspended', IF(email_verified_at IS NULL, 'pending_verification', 'active')),
             updated_at = UTC_TIMESTAMP(3)
         WHERE id = ? AND role <> 'admin'`,
        [suspended ? 1 : 0, userId],
      );
      if (result.affectedRows !== 1) return false;
      if (suspended) {
        await connection.execute(
          `UPDATE sessions SET revoked_at = UTC_TIMESTAMP(3)
           WHERE user_id = ? AND revoked_at IS NULL`,
          [userId],
        );
      }
      return true;
    });
  }

  async listUsers({ query, limit = 50 }) {
    const search = `%${query}%`;
    const [rows] = await this.pool.execute(`
      SELECT ${safeUserColumns}, storage_used_bytes AS storageUsedBytes
      FROM users
      WHERE email LIKE ? OR username LIKE ? OR display_name LIKE ?
      ORDER BY created_at DESC LIMIT ?
    `, [search, search, search, Math.min(Math.max(limit, 1), 100)]);
    return rows;
  }

  async audit({ actorId = null, action, targetType, targetId = null, metadata = null }) {
    await this.pool.execute(
      'INSERT INTO audit_events (actor_id, action, target_type, target_id, metadata) VALUES (?, ?, ?, ?, ?)',
      [actorId, action, targetType, targetId, metadata ? JSON.stringify(metadata) : null],
    );
  }
}
