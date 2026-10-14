import { withTransaction } from './pool.js';

export class MediaRepository {
  constructor(pool, quotaBytes) {
    this.pool = pool;
    this.quotaBytes = quotaBytes;
  }

  async createAttachment({ id, storageKey, conversationId, uploaderId, originalName, detectedMime, byteSize, sha256 }) {
    return withTransaction(this.pool, async (connection) => {
      const [membership] = await connection.execute(`
        SELECT 1 FROM conversation_members cm
        JOIN users u ON u.id = cm.user_id
        WHERE cm.conversation_id = ? AND cm.user_id = ? AND cm.left_at IS NULL AND u.status = 'active'
        FOR UPDATE
      `, [conversationId, uploaderId]);
      if (!membership.length) return { error: 'NOT_A_MEMBER' };
      const [users] = await connection.execute(
        'SELECT storage_used_bytes AS storageUsedBytes FROM users WHERE id = ? FOR UPDATE',
        [uploaderId],
      );
      if (!users.length) return { error: 'USER_NOT_FOUND' };
      const used = Number(users[0].storageUsedBytes);
      if (!Number.isSafeInteger(used) || used + byteSize > this.quotaBytes) return { error: 'QUOTA_EXCEEDED' };
      await connection.execute(`
        INSERT INTO attachments
          (id, conversation_id, uploader_id, storage_key, original_name, detected_mime, byte_size, sha256, scan_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'clean')
      `, [id, conversationId, uploaderId, storageKey, originalName, detectedMime, byteSize, sha256]);
      await connection.execute(
        'UPDATE users SET storage_used_bytes = storage_used_bytes + ? WHERE id = ?',
        [byteSize, uploaderId],
      );
      return { attachment: { id, conversationId, uploaderId, originalName, detectedMime, byteSize } };
    });
  }

  async getAuthorizedAttachment(userId, attachmentId) {
    const [rows] = await this.pool.execute(`
      SELECT a.id, a.storage_key AS storageKey, a.conversation_id AS conversationId,
             a.uploader_id AS uploaderId, a.original_name AS originalName,
             a.detected_mime AS detectedMime, a.byte_size AS byteSize,
             a.sha256 AS sha256
      FROM attachments a
      JOIN conversation_members cm ON cm.conversation_id = a.conversation_id
      JOIN users u ON u.id = cm.user_id
      WHERE a.id = ? AND cm.user_id = ? AND cm.left_at IS NULL
        AND a.scan_status = 'clean' AND a.deleted_at IS NULL AND u.status = 'active'
      LIMIT 1
    `, [attachmentId, userId]);
    return rows[0] ?? null;
  }

  async deleteAttachmentRecord(id, uploaderId) {
    return withTransaction(this.pool, async (connection) => {
      const [rows] = await connection.execute(`
        SELECT byte_size AS byteSize, storage_key AS storageKey
        FROM attachments WHERE id = ? AND uploader_id = ? AND deleted_at IS NULL FOR UPDATE
      `, [id, uploaderId]);
      const attachment = rows[0];
      if (!attachment) return null;
      const [used] = await connection.execute('SELECT id FROM messages WHERE attachment_id = ? LIMIT 1', [id]);
      if (used.length) return null;
      await connection.execute(
        'UPDATE attachments SET deleted_at = UTC_TIMESTAMP(3) WHERE id = ?',
        [id],
      );
      await connection.execute(
        'UPDATE users SET storage_used_bytes = GREATEST(storage_used_bytes - ?, 0) WHERE id = ?',
        [attachment.byteSize, uploaderId],
      );
      return attachment;
    });
  }
}
