import { createHmac } from 'node:crypto';
import { badRequest, conflict, forbidden, notFound, unavailable } from '../http/errors.js';

function callError(code) {
  if (code === 'NOT_A_MEMBER' || code === 'USER_UNAVAILABLE') return forbidden(code);
  if (code === 'CALL_ALREADY_ACTIVE') return conflict(code);
  if (code === 'CALL_NOT_FOUND') return notFound(code);
  if (code === 'CALL_EXPIRED') return conflict(code);
  if (code === 'INVALID_CALL_STATE' || code === 'DIRECT_CONVERSATION_REQUIRED' || code === 'INVALID_ACTION') return badRequest(code);
  return badRequest(code || 'CALL_FAILED');
}

export function createCallService({ repository, notificationService, gateway, turnConfig, now = () => Date.now(), logger = console }) {
  async function publishState(call, userIds = [call.callerId, call.calleeId]) {
    for (const userId of userIds) {
      gateway?.emitToUser(userId, 'call:state', {
        callId: call.callId ?? call.id,
        conversationId: call.conversationId,
        callerId: call.callerId,
        calleeId: call.calleeId,
        mediaType: call.mediaType,
        status: call.status,
        endReason: call.endReason,
        expiresAt: call.expiresAt,
      });
    }
  }

  return Object.freeze({
    async startCall(callerId, { conversationId, mediaType }) {
      const result = await repository.createCall({
        conversationId,
        callerId,
        mediaType,
        expiresAt: new Date(now() + 30_000),
      });
      if (result.error) throw callError(result.error);
      await publishState({ ...result, conversationId, callerId, calleeId: result.calleeId, mediaType });
      await notificationService.publish(
        result.calleeId,
        'incoming_call',
        { callId: result.callId, conversationId, callerId, mediaType },
        { title: `Incoming ${mediaType} call`, body: 'You have an incoming FriendConnect call.', data: { callId: result.callId, conversationId } },
      );
      return { callId: result.callId, conversationId, calleeId: result.calleeId, mediaType, status: result.status, expiresAt: result.expiresAt };
    },

    async transition(actorId, callId, action) {
      const result = await repository.transitionCall(callId, actorId, action);
      if (result.error) throw callError(result.error);
      await publishState(result);
      return { callId: result.id, conversationId: result.conversationId, status: result.status, endReason: result.endReason };
    },

    async authorizeSignal(actorId, callId) {
      const call = await repository.getActiveCallForParticipant(callId, actorId);
      if (!call) throw forbidden('CALL_NOT_ACTIVE_OR_NOT_A_PARTICIPANT');
      const peerId = call.callerId === actorId ? call.calleeId : call.callerId;
      return { peerId, conversationId: call.conversationId, mediaType: call.mediaType };
    },

    async currentCall(userId, conversationId) {
      const call = await repository.getCurrentCallForParticipant(conversationId, userId);
      if (!call) return null;
      return call;
    },

    async history(userId, conversationId, limit) {
      const result = await repository.listHistory(userId, conversationId, limit);
      if (result.error === 'NOT_A_MEMBER') throw forbidden(result.error);
      return result.calls;
    },

    async issueTurnCredentials(userId) {
      if (!turnConfig.sharedSecret || !turnConfig.urls.some((url) => /^turns?:/i.test(url))) {
        throw unavailable('TURN_NOT_CONFIGURED');
      }
      const expiry = Math.floor(now() / 1000) + turnConfig.credentialTtlSeconds;
      const username = `${expiry}:${userId}`;
      const credential = createHmac('sha1', turnConfig.sharedSecret).update(username).digest('base64');
      const stunUrls = turnConfig.urls.filter((url) => /^stuns?:/i.test(url));
      const turnUrls = turnConfig.urls.filter((url) => /^turns?:/i.test(url));
      const iceServers = [];
      if (stunUrls.length) iceServers.push({ urls: stunUrls });
      if (turnUrls.length) iceServers.push({ urls: turnUrls, username, credential });
      return { iceServers, expiresAt: new Date(expiry * 1000).toISOString() };
    },

    async expireCalls() {
      try {
        const calls = await repository.expireStaleCalls();
        for (const call of calls) {
          const missed = call.status === 'ringing';
          await publishState({ ...call, status: missed ? 'missed' : 'ended', endReason: missed ? 'timeout' : 'max_duration' });
          if (missed) {
            await notificationService.publish(
              call.callerId,
              'incoming_call',
              { callId: call.id, conversationId: call.conversationId, status: 'missed' },
              { title: 'Missed call', body: 'Your FriendConnect call was not answered.', data: { callId: call.id, conversationId: call.conversationId } },
            );
          }
        }
        return calls.length;
      } catch (error) {
        logger.error?.({ code: error?.code }, 'Call expiration pass failed');
        return 0;
      }
    },
  });
}
