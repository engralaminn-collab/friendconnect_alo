import { randomUUID } from 'node:crypto';
import { withTransaction } from './pool.js';

export class CallRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async createCall({ conversationId, callerId, mediaType, expiresAt }) {
    return withTransaction(this.pool, async (connection) => {
      const [conversationRows] = await connection.execute(
        "SELECT id FROM conversations WHERE id = ? AND type = 'direct' LIMIT 1 FOR UPDATE",
        [conversationId],
      );
      if (!conversationRows.length) return { error: 'DIRECT_CONVERSATION_REQUIRED' };
      const [members] = await connection.execute(`
        SELECT cm.user_id AS userId, u.status
        FROM conversation_members cm JOIN users u ON u.id = cm.user_id
        WHERE cm.conversation_id = ? AND cm.left_at IS NULL
        FOR UPDATE
      `, [conversationId]);
      if (members.length !== 2 || !members.some((member) => member.userId === callerId)) return { error: 'NOT_A_MEMBER' };
      const callee = members.find((member) => member.userId !== callerId);
      if (!callee || callee.status !== 'active') return { error: 'USER_UNAVAILABLE' };
      const [blocked] = await connection.execute(
        'SELECT 1 FROM user_blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?) LIMIT 1',
        [callerId, callee.userId, callee.userId, callerId],
      );
      if (blocked.length) return { error: 'USER_UNAVAILABLE' };
      const [activeCalls] = await connection.execute(`
        SELECT id FROM calls
        WHERE conversation_id = ? AND status IN ('ringing', 'accepted')
          AND (status = 'accepted' OR expires_at > UTC_TIMESTAMP(3))
        LIMIT 1 FOR UPDATE
      `, [conversationId]);
      if (activeCalls.length) return { error: 'CALL_ALREADY_ACTIVE' };
      const callId = randomUUID();
      await connection.execute(
        `INSERT INTO calls (id, conversation_id, caller_id, callee_id, media_type, status, expires_at)
         VALUES (?, ?, ?, ?, ?, 'ringing', ?)`,
        [callId, conversationId, callerId, callee.userId, mediaType, expiresAt],
      );
      return { callId, calleeId: callee.userId, status: 'ringing', expiresAt };
    });
  }

  async transitionCall(callId, actorId, action) {
    return withTransaction(this.pool, async (connection) => {
      const [rows] = await connection.execute(`
        SELECT id, conversation_id AS conversationId, caller_id AS callerId,
               callee_id AS calleeId, media_type AS mediaType, status,
               expires_at AS expiresAt, (expires_at <= UTC_TIMESTAMP(3)) AS expired
        FROM calls WHERE id = ? FOR UPDATE
      `, [callId]);
      const call = rows[0];
      if (!call || ![call.callerId, call.calleeId].includes(actorId)) return { error: 'CALL_NOT_FOUND' };
      if (action === 'accept') {
        if (actorId !== call.calleeId || call.status !== 'ringing') return { error: 'INVALID_CALL_STATE' };
        if (Number(call.expired) === 1) {
          await connection.execute(
            "UPDATE calls SET status = 'missed', ended_at = UTC_TIMESTAMP(3), end_reason = 'timeout' WHERE id = ?",
            [callId],
          );
          return { error: 'CALL_EXPIRED' };
        }
        await connection.execute(
          "UPDATE calls SET status = 'accepted', answered_at = UTC_TIMESTAMP(3) WHERE id = ?",
          [callId],
        );
        return { ...call, status: 'accepted', actorId };
      }
      if (action === 'decline') {
        if (actorId !== call.calleeId || call.status !== 'ringing') return { error: 'INVALID_CALL_STATE' };
        await connection.execute(
          "UPDATE calls SET status = 'declined', ended_at = UTC_TIMESTAMP(3), end_reason = 'declined' WHERE id = ?",
          [callId],
        );
        return { ...call, status: 'declined', actorId };
      }
      if (action === 'end') {
        if (!['ringing', 'accepted'].includes(call.status)) return { error: 'INVALID_CALL_STATE' };
        const status = 'ended';
        const reason = call.status === 'ringing' ? 'cancelled' : 'ended';
        await connection.execute(
          'UPDATE calls SET status = ?, ended_at = UTC_TIMESTAMP(3), end_reason = ? WHERE id = ?',
          [status, reason, callId],
        );
        return { ...call, status, actorId, endReason: reason };
      }
      return { error: 'INVALID_ACTION' };
    });
  }

  async getCurrentCallForParticipant(conversationId, actorId) {
    const [rows] = await this.pool.execute(`
      SELECT c.id, c.conversation_id AS conversationId, c.caller_id AS callerId,
             c.callee_id AS calleeId, c.media_type AS mediaType, c.status,
             c.expires_at AS expiresAt, c.answered_at AS answeredAt
      FROM calls c
      JOIN conversation_members cm ON cm.conversation_id = c.conversation_id AND cm.user_id = ? AND cm.left_at IS NULL
      WHERE c.conversation_id = ? AND (c.caller_id = ? OR c.callee_id = ?)
        AND (c.status = 'accepted' OR (c.status = 'ringing' AND c.expires_at > UTC_TIMESTAMP(3)))
      ORDER BY c.created_at DESC LIMIT 1
    `, [actorId, conversationId, actorId, actorId]);
    return rows[0] ?? null;
  }

  async getActiveCallForParticipant(callId, actorId) {
    const [rows] = await this.pool.execute(`
      SELECT id, conversation_id AS conversationId, caller_id AS callerId,
             callee_id AS calleeId, media_type AS mediaType, status,
             expires_at AS expiresAt, answered_at AS answeredAt
      FROM calls
      WHERE id = ? AND (caller_id = ? OR callee_id = ?)
        AND status = 'accepted' AND ended_at IS NULL
      LIMIT 1
    `, [callId, actorId, actorId]);
    return rows[0] ?? null;
  }

  async listHistory(userId, conversationId, limit = 25) {
    const [membership] = await this.pool.execute(
      'SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ? AND left_at IS NULL LIMIT 1',
      [conversationId, userId],
    );
    if (!membership.length) return { error: 'NOT_A_MEMBER' };
    const [rows] = await this.pool.execute(`
      SELECT c.id, c.caller_id AS callerId, c.callee_id AS calleeId,
             c.media_type AS mediaType, c.status, c.created_at AS createdAt,
             c.answered_at AS answeredAt, c.ended_at AS endedAt, c.end_reason AS endReason
      FROM calls c WHERE c.conversation_id = ?
      ORDER BY c.created_at DESC LIMIT ?
    `, [conversationId, Math.min(Math.max(limit, 1), 100)]);
    return { calls: rows };
  }

  async expireStaleCalls() {
    return withTransaction(this.pool, async (connection) => {
      const [expired] = await connection.execute(`
        SELECT id, conversation_id AS conversationId, caller_id AS callerId, callee_id AS calleeId, status
        FROM calls
        WHERE (status = 'ringing' AND expires_at <= UTC_TIMESTAMP(3))
           OR (status = 'accepted' AND answered_at <= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 12 HOUR))
        ORDER BY COALESCE(answered_at, expires_at) LIMIT 100 FOR UPDATE
      `);
      if (!expired.length) return [];
      const ids = expired.map((call) => call.id);
      const placeholders = ids.map(() => '?').join(',');
      await connection.execute(`
        UPDATE calls
        SET end_reason = IF(status = 'ringing', 'timeout', 'max_duration'),
            ended_at = UTC_TIMESTAMP(3),
            status = IF(status = 'ringing', 'missed', 'ended')
        WHERE id IN (${placeholders})
          AND ((status = 'ringing' AND expires_at <= UTC_TIMESTAMP(3))
            OR (status = 'accepted' AND answered_at <= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 12 HOUR)))
      `, ids);
      return expired;
    });
  }
}
