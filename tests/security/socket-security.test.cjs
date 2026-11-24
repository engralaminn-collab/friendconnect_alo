'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  findActiveSession,
  createHandshakeMiddleware,
  isSessionActive,
  isMessageParticipant,
  canInteract,
  eventRateLimit,
} = require('../../src/lib/socket-security.cjs')

const token = 'a'.repeat(64)
const user = { id: 'user-a', profile: { callPermission: 'FRIENDS', messagePermission: 'FRIENDS' } }

function prismaWithSession(session) {
  return {
    session: { findUnique: async ({ where }) => where.token === token ? session : null },
  }
}

async function handshake(authToken, session) {
  const middleware = createHandshakeMiddleware(prismaWithSession(session))
  const socket = { handshake: { auth: authToken ? { token: authToken } : {}, headers: {} }, data: {} }
  let result
  await middleware(socket, (error) => { result = error || null })
  return { socket, result }
}

test('handshake rejects missing, malformed, invalid, expired, and revoked sessions', async () => {
  const active = { token, user, expiresAt: new Date(Date.now() + 60_000) }
  assert.ok((await handshake(null, active)).result instanceof Error)
  assert.ok((await handshake('not-a-token', active)).result instanceof Error)
  assert.ok((await handshake(token, null)).result instanceof Error)
  assert.ok((await handshake(token, { ...active, expiresAt: new Date(Date.now() - 1) })).result instanceof Error)
  assert.equal(await isSessionActive(prismaWithSession(null), token), false)
})

test('handshake binds only a valid active DB session', async () => {
  const active = { token, user, expiresAt: new Date(Date.now() + 60_000) }
  const { socket, result } = await handshake(token, active)
  assert.equal(result, null)
  assert.equal(socket.data.authenticatedSessionToken, token)
  assert.equal(socket.data.pendingUser.id, 'user-a')
})

test('cookie handshake accepts only the same valid registry token', async () => {
  const active = { token, user, expiresAt: new Date(Date.now() + 60_000) }
  const middleware = createHandshakeMiddleware(prismaWithSession(active))
  const socket = { handshake: { auth: {}, headers: { cookie: `other=x; fc_session=${token}` } }, data: {} }
  let result
  await middleware(socket, (error) => { result = error || null })
  assert.equal(result, null)
  assert.equal(socket.data.pendingUser.id, 'user-a')
})

test('message authorization is limited to direct participants or group members', async () => {
  const prisma = {
    groupMember: { findUnique: async ({ where }) => where.groupId_userId.userId === 'member' ? { id: 'gm1' } : null },
  }
  assert.equal(await isMessageParticipant(prisma, 'outsider', { senderId: 'sender', receiverId: 'receiver' }), false)
  assert.equal(await isMessageParticipant(prisma, 'receiver', { senderId: 'sender', receiverId: 'receiver' }), true)
  assert.equal(await isMessageParticipant(prisma, 'member', { senderId: 'sender', groupId: 'g1' }), true)
  assert.equal(await isMessageParticipant(prisma, 'outsider', { senderId: 'sender', groupId: 'g1' }), false)
})

test('messaging/calling policy denies blocks and non-friend private targets', async () => {
  const denied = {
    block: { findFirst: async () => null },
    friendship: { findFirst: async () => null },
    user: { findUnique: async () => ({ profile: { messagePermission: 'FRIENDS', callPermission: 'FRIENDS' } }) },
  }
  assert.equal(await canInteract(denied, 'a', 'b', 'messagePermission'), false)
  const blocked = { ...denied, block: { findFirst: async () => ({ id: 'block' }) } }
  assert.equal(await canInteract(blocked, 'a', 'b', 'callPermission'), false)
})

test('accepted friends and public permissions are allowed; self calls are denied', async () => {
  const friends = {
    block: { findFirst: async () => null },
    friendship: { findFirst: async () => ({ id: 'friendship', status: 'ACCEPTED' }) },
    user: { findUnique: async () => ({ profile: { messagePermission: 'FRIENDS' } }) },
  }
  assert.equal(await canInteract(friends, 'a', 'b', 'messagePermission'), true)
  const publicTarget = {
    block: { findFirst: async () => null },
    friendship: { findFirst: async () => null },
    user: { findUnique: async () => ({ profile: { messagePermission: 'PUBLIC' } }) },
  }
  assert.equal(await canInteract(publicTarget, 'a', 'b', 'messagePermission'), true)
  assert.equal(await canInteract(publicTarget, 'a', 'a', 'messagePermission'), false)
})

test('sensitive socket event classes carry explicit rate policies', () => {
  assert.ok(eventRateLimit('message:send'))
  assert.ok(eventRateLimit('call:invite'))
  assert.ok(eventRateLimit('call:offer'))
  assert.ok(eventRateLimit('reaction:add'))
  assert.equal(eventRateLimit('auth'), null)
})
