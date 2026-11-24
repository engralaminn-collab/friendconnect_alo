'use strict'

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
    ...(token ? { auth: { token } } : {}),
  })
  const ready = new Promise((resolve, reject) => {
    socket.once('auth:ok', resolve)
    socket.once('connect_error', reject)
  })
  socket.connect()
  await ready
  return socket
}

async function assertHandshakeRejected(port, token) {
  const socket = io(`http://127.0.0.1:${port}`, {
    autoConnect: false,
    transports: ['websocket'],
    reconnection: false,
    timeout: 2000,
    ...(token ? { auth: { token } } : {}),
  })
  const rejected = new Promise((resolve, reject) => {
    socket.once('connect_error', resolve)
    socket.once('connect', () => reject(new Error('unauthorized socket connected')))
  })
  socket.connect()
  const error = await rejected
  socket.close()
  assert.match(error.message, /unauthorized/i)
}

test('Socket.IO enforces handshake, session revocation, event authorization, and scoped presence', { timeout: 30_000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'friendconnect-security-'))
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

  const ids = { alice: 'security-alice', bob: 'security-bob', outsider: 'security-outsider' }
  const tokens = { alice: 'a'.repeat(64), bob: 'b'.repeat(64), outsider: 'c'.repeat(64), expired: 'd'.repeat(64) }
  for (const [key, id] of Object.entries(ids)) {
    await prisma.user.create({
      data: { id, email: `${key}@security.invalid`, username: key, name: key, passwordHash: 'test-only-hash' },
    })
    await prisma.profile.create({ data: { userId: id, profileVisibility: 'FRIENDS', messagePermission: 'FRIENDS', callPermission: 'FRIENDS' } })
  }
  await prisma.friendship.create({ data: { requesterId: ids.alice, receiverId: ids.bob, status: 'ACCEPTED' } })
  await prisma.session.create({ data: { userId: ids.alice, token: tokens.alice, expiresAt: new Date(Date.now() + 60_000) } })
  await prisma.session.create({ data: { userId: ids.bob, token: tokens.bob, expiresAt: new Date(Date.now() + 60_000) } })
  await prisma.session.create({ data: { userId: ids.outsider, token: tokens.outsider, expiresAt: new Date(Date.now() + 60_000) } })
  await prisma.session.create({ data: { userId: ids.outsider, token: tokens.expired, expiresAt: new Date(Date.now() - 60_000) } })
  const message = await prisma.message.create({
    data: { senderId: ids.alice, receiverId: ids.bob, content: 'private test', status: 'SENT' },
  })
  const group = await prisma.group.create({ data: { name: 'private test group', createdBy: ids.alice } })
  await prisma.groupMember.create({ data: { groupId: group.id, userId: ids.alice, role: 'OWNER' } })
  await prisma.groupMember.create({ data: { groupId: group.id, userId: ids.bob, role: 'MEMBER' } })

  await waitForHealth(port, server).catch((error) => { throw new Error(`${error.message}\n${logs}`) })
  await assertHandshakeRejected(port, null)
  await assertHandshakeRejected(port, 'not-a-session-token')
  await assertHandshakeRejected(port, tokens.expired)

  const bobSocket = await connect(port, tokens.bob)
  const outsiderSocket = await connect(port, tokens.outsider)
  const aliceSocket = await connect(port, tokens.alice)
  sockets.push(bobSocket, outsiderSocket, aliceSocket)

  const incomingCall = new Promise((resolve) => bobSocket.once('call:incoming', resolve))
  const inviteAck = await new Promise((resolve) => aliceSocket.emit('call:invite', { targetUserId: ids.bob, type: 'audio' }, resolve))
  assert.equal(inviteAck.ok, true)
  const invitePayload = await incomingCall
  assert.equal(invitePayload.callerId, ids.alice)
  const acceptedCall = new Promise((resolve) => aliceSocket.once('call:accepted', resolve))
  bobSocket.emit('call:accepted', { toUserId: ids.alice, callId: invitePayload.callId })
  assert.equal((await acceptedCall).fromUserId, ids.bob)

  let friendPresence = false
  let outsiderPresence = false
  bobSocket.on('presence', (payload) => { if (payload.userId === ids.alice && payload.online) friendPresence = true })
  outsiderSocket.on('presence', (payload) => { if (payload.userId === ids.alice && payload.online) outsiderPresence = true })
  // Trigger one fresh presence transition by disconnecting/reconnecting Alice.
  aliceSocket.close()
  const aliceAgain = await connect(port, tokens.alice)
  sockets.push(aliceAgain)
  await new Promise((resolve) => setTimeout(resolve, 200))
  assert.equal(friendPresence, true)
  assert.equal(outsiderPresence, false)

  outsiderSocket.emit('message:seen', { messageId: message.id })
  outsiderSocket.emit('reaction:add', { messageId: message.id, emoji: '🔥' })
  outsiderSocket.emit('group:typing', { groupId: group.id, isTyping: true })
  const inviteResult = await new Promise((resolve) => {
    outsiderSocket.emit('call:invite', { targetUserId: ids.bob, type: 'audio' }, resolve)
  })
  assert.equal(inviteResult.ok, false)
  await new Promise((resolve) => setTimeout(resolve, 150))
  assert.equal((await prisma.message.findUnique({ where: { id: message.id } })).status, 'SENT')
  assert.equal(await prisma.messageReaction.findFirst({ where: { messageId: message.id, userId: ids.outsider } }), null)

  await prisma.session.deleteMany({ where: { token: tokens.alice } })
  aliceAgain.emit('message:seen', { messageId: message.id })
  await new Promise((resolve) => setTimeout(resolve, 200))
  assert.equal(aliceAgain.connected, false, 'revoked socket is disconnected before its event is handled')
})
