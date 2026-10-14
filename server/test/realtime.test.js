import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { io as createClient } from 'socket.io-client';
import { createRealtimeGateway } from '../src/realtime/socket.js';

const conversationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const callId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const users = {
  'session-token-user-one': { id: '11111111-1111-4111-8111-111111111111', role: 'member' },
  'session-token-user-two': { id: '22222222-2222-4222-8222-222222222222', role: 'member' },
  'session-token-outsider': { id: '33333333-3333-4333-8333-333333333333', role: 'member' },
};

function connect(url, token) {
  return new Promise((resolve, reject) => {
    const client = createClient(url, {
      transports: ['websocket'],
      extraHeaders: { Authorization: `Bearer ${token}` },
      reconnection: false,
      timeout: 2000,
    });
    client.once('connect', () => resolve(client));
    client.once('connect_error', (error) => {
      client.close();
      reject(error);
    });
  });
}

function emitAck(client, event, payload) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${event} acknowledgement`)), 2000);
    client.emit(event, payload, (result) => {
      clearTimeout(timer);
      resolve(result);
    });
  });
}

function waitForEvent(client, event) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), 2000);
    client.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

test('Socket.IO authenticates sessions, gates rooms, and relays only authorized call signaling', async () => {
  const gateway = createRealtimeGateway();
  const server = createServer();
  const authService = {
    async authenticateSessionToken(token) {
      const user = users[token];
      if (!user) throw Object.assign(new Error('unauthenticated'), { status: 401, code: 'UNAUTHENTICATED' });
      return { user, clientType: 'mobile', sessionToken: token };
    },
  };
  const chatRepository = {
    async isConversationMember(requestedConversationId, userId) {
      return requestedConversationId === conversationId && userId !== users['session-token-outsider'].id;
    },
  };
  const chatService = {
    async sendMessage(userId, input) {
      const message = { id: 'message-id', senderId: userId, ...input };
      gateway.emitToConversation(input.conversationId, 'message:new', message);
      return message;
    },
  };
  const callService = {
    async authorizeSignal(userId, requestedCallId) {
      if (requestedCallId !== callId || userId !== users['session-token-user-one'].id) {
        throw Object.assign(new Error('not a participant'), { status: 403, code: 'CALL_NOT_ACTIVE_OR_NOT_A_PARTICIPANT' });
      }
      return { peerId: users['session-token-user-two'].id };
    },
  };
  const config = { corsOrigins: ['http://localhost:3000'], sessionCookieName: 'friendconnect_session' };
  gateway.attach(server, { authService, chatRepository, chatService, callService, config, logger: { error() {} } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const clients = [];

  try {
    await assert.rejects(connect(url, 'invalid-token'), /unauthorized/i);
    const sender = await connect(url, 'session-token-user-one');
    const receiver = await connect(url, 'session-token-user-two');
    const outsider = await connect(url, 'session-token-outsider');
    clients.push(sender, receiver, outsider);

    const denied = await emitAck(outsider, 'conversation:join', { conversationId });
    assert.equal(denied.ok, false);
    assert.equal(denied.error.code, 'NOT_A_MEMBER');

    const senderJoin = await emitAck(sender, 'conversation:join', { conversationId });
    const receiverJoin = await emitAck(receiver, 'conversation:join', { conversationId });
    assert.equal(senderJoin.ok, true);
    assert.equal(receiverJoin.ok, true);

    const newMessage = waitForEvent(receiver, 'message:new');
    const sent = await emitAck(sender, 'message:send', {
      conversationId,
      kind: 'text',
      body: 'hello from socket',
    });
    assert.equal(sent.ok, true);
    assert.equal(sent.data.body, 'hello from socket');
    assert.equal((await newMessage).senderId, users['session-token-user-one'].id);

    const signal = waitForEvent(receiver, 'call:signal');
    const relayed = await emitAck(sender, 'call:signal', {
      callId,
      kind: 'offer',
      payload: { type: 'offer', sdp: 'v=0\r\n' },
    });
    assert.equal(relayed.ok, true);
    assert.equal((await signal).fromUserId, users['session-token-user-one'].id);

    const invalidSignal = await emitAck(sender, 'call:signal', {
      callId,
      kind: 'offer',
      payload: { type: 'offer', sdp: 'x'.repeat(70_000) },
    });
    assert.equal(invalidSignal.ok, false);
    assert.equal(invalidSignal.error.code, 'INVALID_SIGNAL');

    const revokedNotice = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out waiting for revocation notice')), 2000);
      receiver.once('session:revoked', (payload, acknowledge) => {
        clearTimeout(timer);
        assert.equal(typeof acknowledge, 'function');
        acknowledge({ received: true });
        resolve(payload);
      });
    });
    const receiverDisconnected = waitForEvent(receiver, 'disconnect');
    assert.equal(gateway.disconnectUser(users['session-token-user-two'].id, 'test revocation'), 1);
    assert.deepEqual(await revokedNotice, { reason: 'test revocation' });
    assert.ok(await receiverDisconnected);
  } finally {
    for (const client of clients) client.close();
    await gateway.close();
  }
});
