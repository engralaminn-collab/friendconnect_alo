import { randomUUID } from 'node:crypto';
import { badRequest, conflict, forbidden, notFound } from '../http/errors.js';

function repositoryError(code) {
  if (['NOT_A_MEMBER', 'NOT_FRIENDS', 'BLOCKED', 'GROUP_MEMBERS_MUST_BE_FRIENDS'].includes(code)) return forbidden(code);
  if (['USER_NOT_FOUND', 'MESSAGE_NOT_FOUND'].includes(code)) return notFound(code);
  if (['ALREADY_FRIENDS', 'REQUEST_EXISTS', 'ATTACHMENT_ALREADY_USED'].includes(code)) return conflict(code);
  return badRequest(code || 'INVALID_REQUEST');
}

export function createChatService({ repository, notificationService, gateway }) {
  return Object.freeze({
    async searchUsers(userId, query, limit) {
      const normalized = typeof query === 'string' ? query.trim().replace(/^@/, '') : '';
      if (normalized.length < 2 || normalized.length > 64) throw badRequest('INVALID_SEARCH_QUERY');
      return repository.searchUsers(userId, normalized, limit);
    },

    async requestFriend(userId, targetId) {
      const result = await repository.requestFriend(userId, targetId);
      if (result.error) throw repositoryError(result.error);
      if (result.status === 'pending') {
        const sender = await repository.getUserSummary(userId);
        await notificationService.publish(
          targetId,
          'friend_request',
          { fromUserId: userId, username: sender?.username, displayName: sender?.displayName },
          { title: 'Friend request', body: `${sender?.displayName || sender?.username || 'A friend'} sent you a request.`, data: { fromUserId: userId } },
        );
      } else if (result.status === 'accepted') {
        await notificationService.publish(
          targetId,
          'friend_request',
          { fromUserId: userId, status: 'accepted' },
          { title: 'Friend request accepted', body: 'Your friend request was accepted.', data: { userId } },
        );
      }
      return result;
    },

    async acceptFriendRequest(userId, otherUserId) {
      const accepted = await repository.acceptFriendRequest(userId, otherUserId);
      if (!accepted) throw notFound('FRIEND_REQUEST_NOT_FOUND');
      await notificationService.publish(
        otherUserId,
        'friend_request',
        { fromUserId: userId, status: 'accepted' },
        { title: 'Friend request accepted', body: 'Your friend request was accepted.', data: { userId } },
      );
      return { accepted: true };
    },

    async removeFriend(userId, otherUserId) {
      await repository.removeFriend(userId, otherUserId);
      return { removed: true };
    },

    async blockUser(userId, targetId) {
      if (!await repository.blockUser(userId, targetId)) throw badRequest('INVALID_USER');
      return { blocked: true };
    },

    async createDirectConversation(userId, otherUserId) {
      const result = await repository.createDirectConversation(userId, otherUserId);
      if (result.error) throw repositoryError(result.error);
      const members = await repository.getConversationMembers(result.conversationId);
      return { ...result, type: 'direct', members };
    },

    async createGroupConversation(userId, { name, memberIds }) {
      const result = await repository.createGroupConversation(userId, name, memberIds);
      if (result.error) throw repositoryError(result.error);
      const members = await repository.getConversationMembers(result.conversationId);
      for (const member of members) {
        if (member.id === userId) continue;
        await notificationService.publish(
          member.id,
          'message',
          { conversationId: result.conversationId, kind: 'group_added' },
          { title: 'Added to a group', body: `${name} is ready for you.`, data: { conversationId: result.conversationId } },
        );
      }
      gateway?.emitToConversation(result.conversationId, 'conversation:created', { id: result.conversationId, type: 'group', name, members });
      return { ...result, type: 'group', name, members };
    },

    async listConversations(userId) {
      const conversations = await repository.listConversations(userId);
      return Promise.all(conversations.map(async (conversation) => ({
        ...conversation,
        members: await repository.getConversationMembers(conversation.id),
      })));
    },

    async listMessages(userId, conversationId, cursor, limit) {
      const result = await repository.listMessages(userId, conversationId, {
        beforeCreatedAt: cursor?.createdAt,
        beforeId: cursor?.id,
        limit,
      });
      if (result.error) throw repositoryError(result.error);
      return result;
    },

    async sendMessage(userId, input) {
      const kind = input.kind ?? 'text';
      const body = typeof input.body === 'string' ? input.body.trim() : null;
      if (kind === 'text' && (!body || !body.length || body.length > 10000 || input.attachmentId)) {
        throw badRequest('INVALID_MESSAGE');
      }
      if (kind !== 'text' && !input.attachmentId) throw badRequest('ATTACHMENT_REQUIRED');
      const result = await repository.createMessage({
        id: randomUUID(),
        conversationId: input.conversationId,
        senderId: userId,
        kind,
        body: kind === 'text' ? body : null,
        attachmentId: input.attachmentId ?? null,
        replyToId: input.replyToId ?? null,
      });
      if (result.error) throw repositoryError(result.error);
      const message = result.message;
      gateway?.emitToConversation(input.conversationId, 'message:new', message);
      const members = await repository.getConversationMembers(input.conversationId);
      const notificationKind = 'message';
      for (const member of members) {
        if (member.id === userId) continue;
        await notificationService.publish(
          member.id,
          notificationKind,
          { conversationId: input.conversationId, messageId: message.id, senderId: userId },
          { title: `Message from ${message.senderDisplayName}`, body: kind === 'text' ? body.slice(0, 120) : `Sent a ${kind} attachment.`, data: { conversationId: input.conversationId, messageId: message.id } },
        );
      }
      return message;
    },

    async markReceipt(userId, input, status) {
      const updated = await repository.markReceipt(userId, input.conversationId, input.messageId, status);
      if (!updated) return { updated: false };
      gateway?.emitToConversation(input.conversationId, 'message:receipt', {
        conversationId: input.conversationId,
        messageId: input.messageId,
        userId,
        status,
      });
      return { updated: true };
    },

    async setReaction(userId, input) {
      const result = await repository.setReaction(userId, input.conversationId, input.messageId, input.emoji, input.active);
      if (result.error) throw repositoryError(result.error);
      gateway?.emitToConversation(input.conversationId, 'message:reaction', result);
      return result;
    },

    async editMessage(userId, messageId, body) {
      const text = typeof body === 'string' ? body.trim() : '';
      if (!text || text.length > 10000) throw badRequest('INVALID_MESSAGE');
      const message = await repository.editMessage(userId, messageId, text);
      if (!message) throw notFound('MESSAGE_NOT_EDITABLE');
      gateway?.emitToConversation(message.conversationId, 'message:updated', message);
      return message;
    },

    async deleteMessage(userId, messageId) {
      const message = await repository.getMessage(messageId);
      if (!message || message.senderId !== userId) throw notFound('MESSAGE_NOT_FOUND');
      const deleted = await repository.deleteMessage(userId, messageId);
      if (!deleted) throw notFound('MESSAGE_NOT_FOUND');
      gateway?.emitToConversation(message.conversationId, 'message:deleted', { messageId });
      return { deleted: true };
    },
  });
}
