'use strict'

/**
 * Regression test for the conversation protocol the chat UI speaks.
 *
 * The UI emitted `message:send` with a `conversationId`, but the realtime server
 * only implemented the receiver/group handlers: it answered
 * `{ ok: false, error: 'Unauthorized' }` and every message sent from the UI was
 * dropped without a visible error. Messages it did store had no `conversationId`,
 * so they never appeared in the thread. `typing:start`/`typing:stop`,
 * `message:react` and `message:read` were unhandled for the same reason, and
 * deletions were only broadcast for direct messages.
 *
 * A separate file from socket-authz.test.cjs because the database runtime is a
 * module singleton: two tests in one file cannot each own a throwaway database.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdtemp, rm } = require('fs/promises')
const { tmpdir } = require('os')
const { join } = require('path')
const { spawn } = require('child_process')
const net = require('net')
const { once } = require('events')
const { io } = require('socket.io-client')

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port
      srv.close((err) => err ? reject(err) : resolve(port))
    })
  })
}

async function waitForHealth(port, child) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`socket server exited early (${child.exitCode})`)
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`)
      if (response.ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('socket server did not become healthy')
}

async function connect(port, token) {
  const socket = io(`http://127.0.0.1:${port}`, {
    autoConnect: false,
    transports: ['websocket'],
    reconnection: false,
    timeout: 3000,
    auth: { token },
  })
  const ready = new Promise((resolve, reject) => {
    socket.once('auth:ok', resolve)
    socket.once('connect_error', reject)
  })
  socket.connect()
  await ready
  return socket
}

test('the conversation protocol the chat UI uses is handled, not silently dropped', { timeout: 30_000 }, async (t) => {

  // Regression: the UI emitted `message:send` with a `conversationId`, but the
  // realtime server only implemented the receiver/group handlers, so it answered
  // `{ ok: false, error: 'Unauthorized' }` and every message sent from the UI was
  // dropped. It also stored messages without `conversationId`, so even a stored
  // message never appeared in the thread.
  const root = await mkdtemp(join(tmpdir(), 'friendconnect-conversation-'))
  const dbFile = join(root, 'test.db')
  process.env.DATABASE_URL = `file:${dbFile}`
  process.env.DB_ENGINE = ''
  process.env.NODE_ENV = 'test'
  const { prisma } = require('../../src/lib/db-runtime.js')
  const port = await freePort()
  const server = spawn(process.execPath, ['socket-server.js'], {
    cwd: join(__dirname, '../..'),
    env: { ...process.env, DATABASE_URL: `file:${dbFile}`, SOCKET_PORT: String(port), NODE_ENV: 'test', REDIS_URL: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let logs = ''
  server.stdout.on('data', (chunk) => { logs += chunk.toString() })
  server.stderr.on('data', (chunk) => { logs += chunk.toString() })
  const sockets = []
  t.after(async () => {
    for (const socket of sockets) socket.close()
    server.kill('SIGTERM')
    await Promise.race([once(server, 'exit'), new Promise((resolve) => setTimeout(resolve, 2000))])
    await prisma.$disconnect?.()
    await rm(root, { recursive: true, force: true })
  })

  const ids = { alice: 'conv-alice', bob: 'conv-bob', eve: 'conv-eve' }
  // Session tokens must be 64 hex characters: `findActiveSession` rejects
  // anything else, so a non-hex token would look like an authorization failure.
  const tokens = { alice: 'e'.repeat(64), bob: 'f'.repeat(64), eve: 'c'.repeat(64) }
  for (const [key, id] of Object.entries(ids)) {
    await prisma.user.create({
      data: { id, email: `${key}@conversation.invalid`, username: key, name: key, passwordHash: 'test-only-hash' },
    })
    await prisma.profile.create({ data: { userId: id, profileVisibility: 'FRIENDS', messagePermission: 'FRIENDS', callPermission: 'FRIENDS' } })
    await prisma.session.create({ data: { userId: id, token: tokens[key], sessionToken: tokens[key], expiresAt: new Date(Date.now() + 60_000) } })
  }
  const conversation = await prisma.conversation.create({
    data: {
      type: 'direct',
      members: { create: [{ userId: ids.alice }, { userId: ids.bob }] },
    },
  })

  await waitForHealth(port, server).catch((error) => { throw new Error(`${error.message}\n${logs}`) })
  const aliceSocket = await connect(port, tokens.alice)
  const bobSocket = await connect(port, tokens.bob)
  const eveSocket = await connect(port, tokens.eve)
  sockets.push(aliceSocket, bobSocket, eveSocket)

  // The message reaches the peer with the conversation attached.
  const delivered = new Promise((resolve) => bobSocket.once('message:new', resolve))
  const ack = await new Promise((resolve) => {
    aliceSocket.emit('message:send', { conversationId: conversation.id, content: 'hello over the socket' }, resolve)
  })
  assert.equal(ack.ok, true, `send must be accepted: ${JSON.stringify(ack)}`)
  const payload = await delivered
  assert.equal(payload.content, 'hello over the socket')
  assert.equal(payload.conversationId, conversation.id)
  assert.equal(payload.senderId, ids.alice)
  // A direct message keeps `receiverId` so the DM-oriented endpoints still work.
  assert.equal(payload.receiverId, ids.bob)

  const stored = await prisma.message.findUnique({ where: { id: payload.id } })
  assert.equal(stored.conversationId, conversation.id, 'the stored row must belong to the conversation')

  // A non-member cannot send into the conversation.
  const eveAck = await new Promise((resolve) => {
    eveSocket.emit('message:send', { conversationId: conversation.id, content: 'intruder' }, resolve)
  })
  assert.equal(eveAck.ok, false)
  assert.equal(eveAck.error, 'Not a member')

  // Reaction and typing events the UI emits are handled and reach the other member.
  const reactionEvent = new Promise((resolve) => bobSocket.once('message:reaction', resolve))
  const reactionAck = await new Promise((resolve) => {
    bobSocket.emit('message:react', { messageId: payload.id, emoji: '👍' }, resolve)
  })
  assert.equal(reactionAck.ok, true)
  const reaction = await reactionEvent
  assert.equal(reaction.messageId, payload.id)
  assert.equal(reaction.op, 'add')
  assert.equal((await prisma.messageReaction.findFirst({ where: { messageId: payload.id, userId: ids.bob } })).emoji, '👍')

  const typingEvent = new Promise((resolve) => bobSocket.once('typing:update', resolve))
  aliceSocket.emit('typing:start', conversation.id)
  const typing = await typingEvent
  assert.deepEqual(typing, { conversationId: conversation.id, userId: ids.alice, isTyping: true })

  const readEvent = new Promise((resolve) => bobSocket.once('message:read', resolve))
  aliceSocket.emit('message:read', { conversationId: conversation.id })
  assert.equal((await readEvent).userId, ids.alice)

  // Deleting reaches the peer too (it used to be broadcast only for DMs).
  const deletedEvent = new Promise((resolve) => bobSocket.once('message:deleted', resolve))
  aliceSocket.emit('message:delete', { messageId: payload.id, scope: 'everyone' })
  const deleted = await deletedEvent
  assert.equal(deleted.id, payload.id)
  assert.equal(deleted.deletedFor, 'everyone')
})
