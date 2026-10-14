import { createHash, randomUUID } from 'node:crypto';

export class NotificationRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async create(userId, kind, payload) {
    const id = randomUUID();
    await this.pool.execute(
      'INSERT INTO notifications (id, user_id, kind, payload) VALUES (?, ?, ?, ?)',
      [id, userId, kind, JSON.stringify(payload)],
    );
    return { id, userId, kind, payload, createdAt: new Date() };
  }

  async list(userId, beforeCreatedAt, beforeId, limit = 30) {
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const cursor = beforeCreatedAt && beforeId
      ? 'AND (created_at < ? OR (created_at = ? AND id < ?))'
      : '';
    const params = [userId, ...(cursor ? [beforeCreatedAt, beforeCreatedAt, beforeId] : []), safeLimit];
    const [rows] = await this.pool.execute(`
      SELECT id, kind, payload, created_at AS createdAt, read_at AS readAt
      FROM notifications WHERE user_id = ? ${cursor}
      ORDER BY created_at DESC, id DESC LIMIT ?
    `, params);
    return rows;
  }

  async markRead(userId, notificationId) {
    const [result] = await this.pool.execute(`
      UPDATE notifications SET read_at = COALESCE(read_at, UTC_TIMESTAMP(3))
      WHERE id = ? AND user_id = ?
    `, [notificationId, userId]);
    if (result.affectedRows > 0) return true;
    const [rows] = await this.pool.execute('SELECT 1 FROM notifications WHERE id = ? AND user_id = ? LIMIT 1', [notificationId, userId]);
    return rows.length === 1;
  }

  async upsertSubscription(userId, endpoint, p256dh, auth) {
    const endpointHash = createHash('sha256').update(endpoint).digest();
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute(
        'SELECT id, user_id AS userId FROM push_subscriptions WHERE endpoint_hash = ? FOR UPDATE',
        [endpointHash],
      );
      const existing = rows[0];
      if (existing && existing.userId !== userId) {
        await connection.rollback();
        return { error: 'SUBSCRIPTION_OWNED_BY_ANOTHER_ACCOUNT' };
      }
      if (existing) {
        await connection.execute(
          `UPDATE push_subscriptions SET endpoint = ?, p256dh = ?, auth = ?, updated_at = UTC_TIMESTAMP(3)
           WHERE id = ?`,
          [endpoint, p256dh, auth, existing.id],
        );
      } else {
        await connection.execute(
          `INSERT INTO push_subscriptions (id, user_id, endpoint_hash, endpoint, p256dh, auth)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [randomUUID(), userId, endpointHash, endpoint, p256dh, auth],
        );
      }
      await connection.commit();
      return { saved: true };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async listSubscriptions(userId) {
    const [rows] = await this.pool.execute(
      'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?',
      [userId],
    );
    return rows;
  }

  async removeSubscription(userId, endpoint) {
    const endpointHash = createHash('sha256').update(endpoint).digest();
    const [result] = await this.pool.execute(
      'DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint_hash = ?',
      [userId, endpointHash],
    );
    return result.affectedRows > 0;
  }

  async removeSubscriptionByEndpoint(endpoint) {
    const endpointHash = createHash('sha256').update(endpoint).digest();
    await this.pool.execute('DELETE FROM push_subscriptions WHERE endpoint_hash = ?', [endpointHash]);
  }
}
