import { randomUUID } from 'node:crypto';
import { withTransaction } from './pool.js';

const userPair = (left, right) => [left, right].sort();

export class ChatRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async getUserSummary(userId) {
    const [rows] = await this.pool.execute(
      "SELECT id, username, display_name AS displayName FROM users WHERE id = ? AND status = 'active' LIMIT 1",
      [userId],
    );
    return rows[0] ?? null;
  }

  async searchUsers(actorId, query, limit = 20) {
    const like = `%${query}%`;
    const [rows] = await this.pool.execute(`
      SELECT u.id, u.username, u.display_name AS displayName
      FROM users u
      WHERE u.status = 'active' AND u.id <> ?
        AND (u.username LIKE ? OR u.display_name LIKE ?)
        AND NOT EXISTS (
          SELECT 1 FROM user_blocks b
          WHERE (b.blocker_id = ? AND b.blocked_id = u.id)
             OR (b.blocker_id = u.id AND b.blocked_id = ?)
        )
      ORDER BY u.username LIMIT ?
    `, [actorId, like, like, actorId, actorId, Math.min(Math.max(limit, 1), 50)]);
    return rows;
  }

  async requestFriend(actorId, targetId) {
    if (actorId === targetId) return { error: 'SELF_REQUEST' };
    return withTransaction(this.pool, async (connection) => {
      const [target] = await connection.execute("SELECT id FROM users WHERE id = ? AND status = 'active'", [targetId]);
      if (!target.length) return { error: 'USER_NOT_FOUND' };
      const [blocks] = await connection.execute(`
        SELECT 1 FROM user_blocks
        WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)
        LIMIT 1
      `, [actorId, targetId, targetId, actorId]);
      if (blocks.length) return { error: 'BLOCKED' };
      const [low, high] = userPair(actorId, targetId);
      const [rows] = await connection.execute(
        'SELECT requested_by AS requestedBy, status FROM friendships WHERE user_low = ? AND user_high = ? FOR UPDATE',
        [low, high],
      );
      const current = rows[0];
      if (!current) {
        const [inserted] = await connection.execute(
          "INSERT IGNORE INTO friendships (user_low, user_high, requested_by, status) VALUES (?, ?, ?, 'pending')",
          [low, high, actorId],
        );
        if (inserted.affectedRows === 1) return { status: 'pending' };
        const [concurrentRows] = await connection.execute(
          'SELECT requested_by AS requestedBy, status FROM friendships WHERE user_low = ? AND user_high = ? FOR UPDATE',
          [low, high],
        );
        const concurrent = concurrentRows[0];
        if (!concurrent) return { error: 'REQUEST_FAILED' };
        if (concurrent.status === 'accepted') return { error: 'ALREADY_FRIENDS' };
        if (concurrent.requestedBy === actorId) return { error: 'REQUEST_EXISTS' };
        await connection.execute(
          "UPDATE friendships SET status = 'accepted' WHERE user_low = ? AND user_high = ?",
          [low, high],
        );
        return { status: 'accepted' };
      }
      if (current.status === 'accepted') return { error: 'ALREADY_FRIENDS' };
      if (current.requestedBy === actorId) return { error: 'REQUEST_EXISTS' };
      await connection.execute(
        "UPDATE friendships SET status = 'accepted' WHERE user_low = ? AND user_high = ?",
        [low, high],
      );
      return { status: 'accepted' };
    });
  }

  async listFriends(userId) {
    const [rows] = await this.pool.execute(`
      SELECT u.id, u.username, u.display_name AS displayName,
             f.updated_at AS since
      FROM friendships f
      JOIN users u ON u.id = IF(f.user_low = ?, f.user_high, f.user_low)
      WHERE (f.user_low = ? OR f.user_high = ?) AND f.status = 'accepted' AND u.status = 'active'
      ORDER BY u.username
    `, [userId, userId, userId]);
    return rows;
  }

  async listFriendRequests(userId) {
    const [rows] = await this.pool.execute(`
      SELECT f.user_low AS userLow, f.user_high AS userHigh, f.requested_by AS requestedBy,
             f.created_at AS createdAt, u.id AS otherUserId, u.username AS otherUsername,
             u.display_name AS otherDisplayName,
             IF(f.requested_by = ?, 'outgoing', 'incoming') AS direction
      FROM friendships f
      JOIN users u ON u.id = IF(f.requested_by = ?, IF(f.user_low = ?, f.user_high, f.user_low), f.requested_by)
      WHERE (f.user_low = ? OR f.user_high = ?) AND f.status = 'pending'
      ORDER BY f.created_at DESC
    `, [userId, userId, userId, userId, userId]);
    return rows;
  }

  async acceptFriendRequest(actorId, otherUserId) {
    const [low, high] = userPair(actorId, otherUserId);
    const [result] = await this.pool.execute(`
      UPDATE friendships SET status = 'accepted'
      WHERE user_low = ? AND user_high = ? AND requested_by = ? AND status = 'pending'
    `, [low, high, otherUserId]);
    return result.affectedRows === 1;
  }

  async removeFriend(userId, otherUserId) {
    const [low, high] = userPair(userId, otherUserId);
    const [result] = await this.pool.execute(
      'DELETE FROM friendships WHERE user_low = ? AND user_high = ?',
      [low, high],
    );
    return result.affectedRows > 0;
  }

  async blockUser(blockerId, blockedId) {
    if (blockerId === blockedId) return false;
    return withTransaction(this.pool, async (connection) => {
      const [target] = await connection.execute("SELECT id FROM users WHERE id = ? AND status = 'active' LIMIT 1", [blockedId]);
      if (!target.length) return false;
      await connection.execute(
        'INSERT INTO user_blocks (blocker_id, blocked_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE created_at = created_at',
        [blockerId, blockedId],
      );
      const [low, high] = userPair(blockerId, blockedId);
      await connection.execute('DELETE FROM friendships WHERE user_low = ? AND user_high = ?', [low, high]);
      return true;
    });
  }

  async createDirectConversation(actorId, otherUserId) {
    if (actorId === otherUserId) return { error: 'INVALID_PARTICIPANTS' };
    const [first, second] = userPair(actorId, otherUserId);
    const directKey = `${first}:${second}`;
    return withTransaction(this.pool, async (connection) => {
      const [relationship] = await connection.execute(`
        SELECT status FROM friendships
        WHERE user_low = ? AND user_high = ? AND status = 'accepted'
        FOR UPDATE
      `, [first, second]);
      if (!relationship.length) return { error: 'NOT_FRIENDS' };
      const [blocked] = await connection.execute(`
        SELECT 1 FROM user_blocks
        WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?) LIMIT 1
      `, [actorId, otherUserId, otherUserId, actorId]);
      if (blocked.length) return { error: 'BLOCKED' };
      const [existing] = await connection.execute('SELECT id FROM conversations WHERE direct_key = ? LIMIT 1', [directKey]);
      let conversationId = existing[0]?.id;
      if (!conversationId) {
        conversationId = randomUUID();
        await connection.execute(
          `INSERT INTO conversations (id, type, direct_key, created_by) VALUES (?, 'direct', ?, ?)`,
          [conversationId, directKey, actorId],
        );
        await connection.execute(
          `INSERT INTO conversation_members (conversation_id, user_id, role) VALUES (?, ?, 'admin'), (?, ?, 'member')`,
          [conversationId, actorId, conversationId, otherUserId],
        );
      }
      return { conversationId };
    });
  }

  async createGroupConversation(actorId, name, memberIds) {
    const members = [...new Set([actorId, ...memberIds])];
    if (members.length < 3 || members.length > 30) return { error: 'INVALID_GROUP_SIZE' };
    return withTransaction(this.pool, async (connection) => {
      for (const memberId of members) {
        if (memberId === actorId) continue;
        const [low, high] = userPair(actorId, memberId);
        const [friend] = await connection.execute(
          "SELECT 1 FROM friendships WHERE user_low = ? AND user_high = ? AND status = 'accepted'",
          [low, high],
        );
        const [blocked] = await connection.execute(
          'SELECT 1 FROM user_blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?) LIMIT 1',
          [actorId, memberId, memberId, actorId],
        );
        if (!friend.length || blocked.length) return { error: 'GROUP_MEMBERS_MUST_BE_FRIENDS' };
      }
      const placeholders = members.map(() => '?').join(',');
      const [active] = await connection.execute(
        `SELECT id FROM users WHERE status = 'active' AND id IN (${placeholders})`, members,
      );
      if (active.length !== members.length) return { error: 'USER_NOT_FOUND' };
      const conversationId = randomUUID();
      await connection.execute(
        "INSERT INTO conversations (id, type, name, created_by) VALUES (?, 'group', ?, ?)",
        [conversationId, name, actorId],
      );
      const values = members.flatMap((memberId) => [conversationId, memberId, memberId === actorId ? 'admin' : 'member']);
      const memberPlaceholders = members.map(() => '(?, ?, ?)').join(',');
      await connection.execute(
        `INSERT INTO conversation_members (conversation_id, user_id, role) VALUES ${memberPlaceholders}`,
        values,
      );
      return { conversationId };
    });
  }

  async listConversations(userId) {
    const [rows] = await this.pool.execute(`
      SELECT c.id, c.type, c.name, c.created_by AS createdBy,
             c.created_at AS createdAt, c.updated_at AS updatedAt,
             (SELECT m.id FROM messages m WHERE m.conversation_id = c.id AND m.deleted_at IS NULL
              ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS lastMessageId,
             (SELECT m.kind FROM messages m WHERE m.conversation_id = c.id AND m.deleted_at IS NULL
              ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS lastMessageKind,
             (SELECT m.body FROM messages m WHERE m.conversation_id = c.id AND m.deleted_at IS NULL
              ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS lastMessageBody,
             (SELECT m.created_at FROM messages m WHERE m.conversation_id = c.id AND m.deleted_at IS NULL
              ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS lastMessageAt
      FROM conversations c
      JOIN conversation_members cm ON cm.conversation_id = c.id
      WHERE cm.user_id = ? AND cm.left_at IS NULL
      ORDER BY COALESCE(lastMessageAt, c.updated_at) DESC
    `, [userId]);
    return rows;
  }

  async getConversationMembers(conversationId) {
    const [rows] = await this.pool.execute(`
      SELECT u.id, u.username, u.display_name AS displayName, cm.role,
             cm.joined_at AS joinedAt
      FROM conversation_members cm JOIN users u ON u.id = cm.user_id
      WHERE cm.conversation_id = ? AND cm.left_at IS NULL
      ORDER BY cm.joined_at, u.username
    `, [conversationId]);
    return rows;
  }

  async isConversationMember(conversationId, userId) {
    const [rows] = await this.pool.execute(
      'SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ? AND left_at IS NULL LIMIT 1',
      [conversationId, userId],
    );
    return rows.length === 1;
  }

  async getConversation(conversationId) {
    const [rows] = await this.pool.execute(
      'SELECT id, type, name, created_by AS createdBy FROM conversations WHERE id = ? LIMIT 1',
      [conversationId],
    );
    return rows[0] ?? null;
  }

  async createMessage({ id, conversationId, senderId, kind, body, attachmentId = null, replyToId = null }) {
    return withTransaction(this.pool, async (connection) => {
      const [membership] = await connection.execute(`
        SELECT 1 FROM conversation_members cm JOIN users u ON u.id = cm.user_id
        WHERE cm.conversation_id = ? AND cm.user_id = ? AND cm.left_at IS NULL AND u.status = 'active'
        FOR UPDATE
      `, [conversationId, senderId]);
      if (!membership.length) return { error: 'NOT_A_MEMBER' };
      if (attachmentId) {
        const [attachments] = await connection.execute(`
          SELECT id FROM attachments
          WHERE id = ? AND conversation_id = ? AND uploader_id = ?
            AND scan_status = 'clean' AND deleted_at IS NULL
          FOR UPDATE
        `, [attachmentId, conversationId, senderId]);
        if (!attachments.length) return { error: 'INVALID_ATTACHMENT' };
        const [used] = await connection.execute('SELECT id FROM messages WHERE attachment_id = ? LIMIT 1', [attachmentId]);
        if (used.length) return { error: 'ATTACHMENT_ALREADY_USED' };
      }
      if (replyToId) {
        const [replies] = await connection.execute(
          'SELECT id FROM messages WHERE id = ? AND conversation_id = ? AND deleted_at IS NULL LIMIT 1',
          [replyToId, conversationId],
        );
        if (!replies.length) return { error: 'INVALID_REPLY' };
      }
      await connection.execute(
        `INSERT INTO messages (id, conversation_id, sender_id, kind, body, attachment_id, reply_to_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, conversationId, senderId, kind, body, attachmentId, replyToId],
      );
      await connection.execute(
        'UPDATE conversations SET updated_at = UTC_TIMESTAMP(3) WHERE id = ?',
        [conversationId],
      );
      await connection.execute(`
        INSERT INTO message_receipts (message_id, user_id)
        SELECT ?, user_id FROM conversation_members
        WHERE conversation_id = ? AND user_id <> ? AND left_at IS NULL
      `, [id, conversationId, senderId]);
      const message = await this.getMessageOnConnection(connection, id);
      return { message: (await this.attachMessageMetadataOnConnection(connection, [message]))[0] };
    });
  }

  async getMessageOnConnection(connection, messageId) {
    const [rows] = await connection.execute(`
      SELECT m.id, m.conversation_id AS conversationId, m.sender_id AS senderId,
             u.username AS senderUsername, u.display_name AS senderDisplayName,
             m.kind, m.body, m.attachment_id AS attachmentId, m.reply_to_id AS replyToId,
             m.created_at AS createdAt, m.edited_at AS editedAt, m.deleted_at AS deletedAt,
             a.original_name AS attachmentName, a.detected_mime AS attachmentMime,
             a.byte_size AS attachmentBytes
      FROM messages m JOIN users u ON u.id = m.sender_id
      LEFT JOIN attachments a ON a.id = m.attachment_id
      WHERE m.id = ? LIMIT 1
    `, [messageId]);
    return rows[0] ?? null;
  }

  async getMessage(messageId) {
    const connection = await this.pool.getConnection();
    try {
      return await this.getMessageOnConnection(connection, messageId);
    } finally {
      connection.release();
    }
  }

  async attachMessageMetadataOnConnection(connection, messages) {
    if (!messages.length) return messages;
    const ids = messages.map((message) => message.id);
    const placeholders = ids.map(() => '?').join(',');
    const [receipts] = await connection.execute(`
      SELECT message_id AS messageId, user_id AS userId,
             delivered_at AS deliveredAt, seen_at AS seenAt
      FROM message_receipts WHERE message_id IN (${placeholders})
    `, ids);
    const [reactions] = await connection.execute(`
      SELECT message_id AS messageId, user_id AS userId, emoji
      FROM message_reactions WHERE message_id IN (${placeholders})
      ORDER BY created_at
    `, ids);
    const byId = new Map(messages.map((message) => [message.id, { ...message, receipts: [], reactions: [] }]));
    for (const receipt of receipts) byId.get(receipt.messageId)?.receipts.push(receipt);
    for (const reaction of reactions) byId.get(reaction.messageId)?.reactions.push(reaction);
    return messages.map((message) => byId.get(message.id));
  }

  async listMessages(userId, conversationId, { beforeCreatedAt, beforeId, limit = 50 }) {
    if (!await this.isConversationMember(conversationId, userId)) return { error: 'NOT_A_MEMBER' };
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const cursorClause = beforeCreatedAt && beforeId
      ? 'AND (m.created_at < ? OR (m.created_at = ? AND m.id < ?))'
      : '';
    const params = [conversationId, ...(cursorClause ? [beforeCreatedAt, beforeCreatedAt, beforeId] : []), safeLimit + 1];
    const [rows] = await this.pool.execute(`
      SELECT m.id, m.conversation_id AS conversationId, m.sender_id AS senderId,
             u.username AS senderUsername, u.display_name AS senderDisplayName,
             m.kind, m.body, m.attachment_id AS attachmentId, m.reply_to_id AS replyToId,
             m.created_at AS createdAt, m.edited_at AS editedAt, m.deleted_at AS deletedAt,
             a.original_name AS attachmentName, a.detected_mime AS attachmentMime,
             a.byte_size AS attachmentBytes
      FROM messages m JOIN users u ON u.id = m.sender_id
      LEFT JOIN attachments a ON a.id = m.attachment_id
      WHERE m.conversation_id = ? AND m.deleted_at IS NULL ${cursorClause}
      ORDER BY m.created_at DESC, m.id DESC LIMIT ?
    `, params);
    const hasMore = rows.length > safeLimit;
    const page = rows.slice(0, safeLimit).reverse();
    const messages = await this.attachMessageMetadataOnConnection(this.pool, page);
    return { messages, hasMore, nextCursor: hasMore && page.length ? { createdAt: page[0].createdAt, id: page[0].id } : null };
  }

  async markReceipt(userId, conversationId, messageId, status) {
    if (!['delivered', 'seen'].includes(status)) return false;
    const column = status === 'seen' ? 'seen_at' : 'delivered_at';
    const [result] = await this.pool.execute(`
      UPDATE message_receipts r
      JOIN messages m ON m.id = r.message_id
      SET r.${column} = COALESCE(r.${column}, UTC_TIMESTAMP(3)),
          r.delivered_at = IF(? = 'seen', COALESCE(r.delivered_at, UTC_TIMESTAMP(3)), r.delivered_at)
      WHERE r.message_id = ? AND r.user_id = ? AND m.conversation_id = ?
    `, [status, messageId, userId, conversationId]);
    return result.affectedRows > 0;
  }

  async setReaction(userId, conversationId, messageId, emoji, active) {
    const [membership] = await this.pool.execute(
      'SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ? AND left_at IS NULL LIMIT 1',
      [conversationId, userId],
    );
    if (!membership.length) return { error: 'NOT_A_MEMBER' };
    const [message] = await this.pool.execute(
      'SELECT 1 FROM messages WHERE id = ? AND conversation_id = ? AND deleted_at IS NULL LIMIT 1',
      [messageId, conversationId],
    );
    if (!message.length) return { error: 'MESSAGE_NOT_FOUND' };
    if (active) {
      await this.pool.execute(
        'INSERT IGNORE INTO message_reactions (message_id, user_id, emoji) VALUES (?, ?, ?)',
        [messageId, userId, emoji],
      );
    } else {
      await this.pool.execute(
        'DELETE FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?',
        [messageId, userId, emoji],
      );
    }
    return { messageId, userId, emoji, active };
  }

  async editMessage(userId, messageId, body) {
    const [result] = await this.pool.execute(`
      UPDATE messages m
      JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = ? AND cm.left_at IS NULL
      SET m.body = ?, m.edited_at = UTC_TIMESTAMP(3)
      WHERE m.id = ? AND m.sender_id = ? AND m.kind = 'text' AND m.deleted_at IS NULL
        AND m.created_at >= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 15 MINUTE)
    `, [userId, body, messageId, userId]);
    return result.affectedRows === 1 ? this.getMessage(messageId) : null;
  }

  async deleteMessage(userId, messageId) {
    const [result] = await this.pool.execute(`
      UPDATE messages m
      JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = ? AND cm.left_at IS NULL
      SET m.body = NULL, m.deleted_at = UTC_TIMESTAMP(3)
      WHERE m.id = ? AND m.sender_id = ? AND m.deleted_at IS NULL
    `, [userId, messageId, userId]);
    return result.affectedRows === 1;
  }
}
