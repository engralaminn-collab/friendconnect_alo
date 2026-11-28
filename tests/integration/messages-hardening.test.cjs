'use strict'

/**
 * Regression tests for the Stage A message-handling findings.
 *
 * Every assertion below failed before the remediation, against a real server and
 * a real SQLite database — no mocks of the code under test.
 *
 *   #6  POST /api/messages had no length limit (socket and conversation routes
 *       capped at 10 000 characters).
 *   #7  GET /api/groups/[id]/messages returned messages scheduled for the future.
 *   #8  GET /api/messages marked messages SEEN regardless of Profile.readReceipts.
 *   #9  Cancelling a scheduled message deleted the row, losing the audit trail.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdtemp, rm } = require('fs/promises')
const { tmpdir } = require('os')
const { join, resolve } = require('path')
const { spawn } = require('child_process')
const net = require('net')

const repo = resolve(__dirname, '../..')

function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      server.close((error) => (error ? reject(error) : resolvePort(port)))
    })
  })
}

function collectCookies(response, jar) {
  const headers = response.headers.getSetCookie?.() || [response.headers.get('set-cookie')].filter(Boolean)
  for (const header of headers) {
    const pair = header.split(';', 1)[0]
    const index = pair.indexOf('=')
    if (index > 0) {
      const name = pair.slice(0, index)
      const value = pair.slice(index + 1)
      if (value) jar.set(name, value)
      else jar.delete(name)
    }
  }
}

const cookieHeader = (jar) => Array.from(jar, ([name, value]) => `${name}=${value}`).join('; ')

async function waitHealthy(url, child, output) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited early (${child.exitCode})\n${output()}`)
    try {
      if ((await fetch(`${url}/api/health`)).status < 500) return
    } catch {}
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`health timeout\n${output()}`)
}

/**
 * A stand-in for the realtime server's `/internal/emit` endpoint.
 *
 * Finding 5 was that `POST /api/messages` persisted a message and emitted
 * nothing, so the REST fallback the chat UI uses when the socket is down was
 * silently dead. Asserting on this recorder proves the emit actually leaves the
 * process with the right recipients and event name — a mock of the route would
 * not.
 */
function startEmitRecorder() {
  const received = []
  const server = require('http').createServer((req, res) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      let body = null
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch {}
      received.push({ url: req.url, secret: req.headers['x-internal-secret'], body })
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{"ok":true}')
    })
  })
  return new Promise((resolveServer) => {
    server.listen(0, '127.0.0.1', () => resolveServer({ server, received, port: server.address().port }))
  })
}

async function register(base, name) {
  const jar = new Map()
  const suffix = `${name}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`.toLowerCase()
  const credentials = { name, username: suffix, email: `${suffix}@security.invalid`, password: 'ValidPassw0rd!' }
  const response = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(credentials),
  })
  const text = await response.text()
  assert.equal(response.status, 201, `register failed: ${text}`)
  return { jar, credentials, id: JSON.parse(text)?.user?.id }
}

async function login(base, jar, credentials) {
  const csrfResponse = await fetch(`${base}/api/auth/csrf`)
  collectCookies(csrfResponse, jar)
  const { csrfToken } = await csrfResponse.json()
  const form = new URLSearchParams({
    csrfToken,
    identifier: credentials.username,
    password: credentials.password,
    callbackUrl: `${base}/`,
    json: 'true',
  })
  const response = await fetch(`${base}/api/auth/callback/credentials`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookieHeader(jar) },
    body: form,
  })
  collectCookies(response, jar)
  return response.status
}

function client(base, jar) {
  return async function call(path, init = {}) {
    const headers = { cookie: cookieHeader(jar), ...(init.headers || {}) }
    if (init.body) headers['content-type'] = 'application/json'
    const response = await fetch(`${base}${path}`, { ...init, headers })
    const text = await response.text()
    let body = null
    try {
      body = text ? JSON.parse(text) : null
    } catch {
      body = text
    }
    return { status: response.status, body, text }
  }
}

test('messages: length policy, scheduling, read receipts and cancellation', { timeout: 180_000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'friendconnect-messages-'))
  const dbFile = join(root, 'messages.sqlite')
  const appPort = await freePort()
  const recorder = await startEmitRecorder()
  const socketPort = recorder.port
  const base = `http://127.0.0.1:${appPort}`

  const env = {
    ...process.env,
    NODE_ENV: 'production',
    DATABASE_URL: `file:${dbFile}`,
    NEXTAUTH_SECRET: 'integration-only-not-a-production-secret',
    NEXTAUTH_URL: base,
    APP_ORIGIN: base,
    APP_DIR: repo,
    UPLOAD_DIR: join(root, 'uploads'),
    PORT: String(appPort),
    HOSTNAME: '127.0.0.1',
    SOCKET_PORT: String(socketPort),
    SOCKET_INTERNAL_URL: `http://127.0.0.1:${socketPort}`,
    REDIS_URL: '',
  }

  const app = spawn(process.execPath, [join(repo, '.next/standalone/server.js')], {
    cwd: join(repo, '.next/standalone'),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let logs = ''
  app.stdout.on('data', (d) => (logs += d.toString()))
  app.stderr.on('data', (d) => (logs += d.toString()))

  t.after(async () => {
    app.kill('SIGTERM')
    await new Promise((done) => (app.exitCode !== null ? done() : app.once('exit', done)))
    await new Promise((done) => recorder.server.close(done))
    await rm(root, { recursive: true, force: true })
  })

  await waitHealthy(base, app, () => logs)

  const alice = await register(base, 'Alice')
  const bob = await register(base, 'Bob')
  for (const account of [alice, bob]) {
    assert.ok([200, 302].includes(await login(base, account.jar, account.credentials)), 'login failed')
  }
  const a = client(base, alice.jar)
  const b = client(base, bob.jar)
  const aliceId = (await a('/api/me')).body?.user?.id
  const bobId = (await b('/api/me')).body?.user?.id
  assert.ok(aliceId && bobId, 'could not read user ids')

  // The default messagePermission is FRIENDS, so establish the friendship the
  // rest of the test assumes.
  const request = await a('/api/friends', { method: 'POST', body: JSON.stringify({ action: 'request', targetId: bobId }) })
  assert.ok([200, 201].includes(request.status), `friend request failed: ${request.status} ${request.text}`)
  const accept = await b(`/api/friends/request/${aliceId}/accept`, { method: 'POST' })
  assert.ok([200, 204].includes(accept.status), `friend accept failed: ${accept.status} ${accept.text}`)

  // ===== finding #6: the REST fallback enforces the same length policy =====
  const tooLong = await a('/api/messages', {
    method: 'POST',
    body: JSON.stringify({ receiverId: bobId, content: 'x'.repeat(10_001) }),
  })
  assert.equal(tooLong.status, 413, `over-long body must be refused, got ${tooLong.status} ${tooLong.text}`)

  const huge = await a('/api/messages', {
    method: 'POST',
    body: JSON.stringify({ receiverId: bobId, content: 'y'.repeat(2_000_000) }),
  })
  assert.equal(huge.status, 413, `a 2 MB body must be refused, got ${huge.status}`)

  const atLimit = await a('/api/messages', {
    method: 'POST',
    body: JSON.stringify({ receiverId: bobId, content: 'z'.repeat(10_000) }),
  })
  assert.equal(atLimit.status, 200, `exactly 10 000 characters must be accepted, got ${atLimit.status}`)

  const empty = await a('/api/messages', {
    method: 'POST',
    body: JSON.stringify({ receiverId: bobId, content: '   ' }),
  })
  assert.equal(empty.status, 400, `a blank body must be refused, got ${empty.status}`)

  // ===== finding #5: the REST fallback reaches the realtime server =====
  recorder.received.length = 0
  const emitted = await a('/api/messages', {
    method: 'POST',
    body: JSON.stringify({ receiverId: bobId, content: 'delivered over REST' }),
  })
  assert.equal(emitted.status, 200, JSON.stringify(emitted.body))
  const emittedId = emitted.body?.message?.id

  // `emitRealtimeToUsers` is fire-and-forget (it must never fail the send), so
  // give it a moment rather than assuming the fetch has resolved.
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline && !recorder.received.some((r) => r.body?.event === 'message:new')) {
    await new Promise((r) => setTimeout(r, 50))
  }
  const emits = recorder.received.filter((r) => r.url === '/internal/emit')
  assert.ok(emits.length > 0, 'POST /api/messages must notify the realtime server')
  const newMessage = emits.find((r) => r.body?.event === 'message:new' && r.body?.payload?.id === emittedId)
  assert.ok(newMessage, `no message:new for ${emittedId}: ${JSON.stringify(emits.map((e) => e.body))}`)
  assert.ok(newMessage.secret, 'the internal emit must be authenticated with a shared secret')
  assert.ok(
    (newMessage.body.userIds || []).includes(bobId),
    'the recipient must be in the emit audience',
  )
  assert.ok(
    (newMessage.body.userIds || []).includes(aliceId),
    'the sender must be in the emit audience so their other devices stay in sync',
  )

  // ===== finding #7: a scheduled group message is not readable early =====
  const group = await a('/api/groups', {
    method: 'POST',
    body: JSON.stringify({ name: 'Launch planning', memberIds: [bobId] }),
  })
  assert.equal(group.status, 200, `group create failed: ${group.status} ${group.text}`)
  const groupId = group.body?.group?.id
  assert.ok(groupId, 'group id missing')

  const groupSchedule = await a('/api/messages/scheduled', {
    method: 'POST',
    body: JSON.stringify({
      groupId,
      content: 'this must stay hidden until it is due',
      scheduledFor: new Date(Date.now() + 3_600_000).toISOString(),
    }),
  })
  assert.equal(groupSchedule.status, 200, JSON.stringify(groupSchedule.body))
  const groupScheduledId = groupSchedule.body?.message?.id

  const bobGroupView = await b(`/api/groups/${groupId}/messages`)
  assert.equal(bobGroupView.status, 200, bobGroupView.text)
  assert.ok(
    !(bobGroupView.body?.messages || []).some((m) => m.id === groupScheduledId),
    'a group message scheduled for the future must not be readable before it is due',
  )

  // The sender must not see it in the thread either: it belongs to the
  // "scheduled" list, not the delivered history.
  const aliceGroupView = await a(`/api/groups/${groupId}/messages`)
  assert.equal(aliceGroupView.status, 200)
  assert.ok(
    !(aliceGroupView.body?.messages || []).some((m) => m.id === groupScheduledId),
    'a scheduled group message must not appear in the delivered thread',
  )

  // A due message does appear (control: the filter is about time, not a blanket
  // exclusion of anything with a schedule).
  const dueSchedule = await a('/api/messages/scheduled', {
    method: 'POST',
    body: JSON.stringify({ groupId, content: 'due now', scheduledFor: new Date(Date.now() + 400).toISOString() }),
  })
  assert.equal(dueSchedule.status, 200, JSON.stringify(dueSchedule.body))
  const dueId = dueSchedule.body?.message?.id
  await new Promise((r) => setTimeout(r, 700))
  const afterDue = await b(`/api/groups/${groupId}/messages`)
  assert.ok(
    (afterDue.body?.messages || []).some((m) => m.id === dueId),
    'a scheduled group message must become readable once its time has passed',
  )

  // ===== finding #8: read receipts off means the sender never sees SEEN =====
  // Carol sends to Dave; Dave turns read receipts off and opens the thread.
  const carol = await register(base, 'Carol')
  const dave = await register(base, 'Dave')
  for (const account of [carol, dave]) {
    assert.ok([200, 302].includes(await login(base, account.jar, account.credentials)), 'login failed')
  }
  const c = client(base, carol.jar)
  const d = client(base, dave.jar)
  const carolId = (await c('/api/me')).body?.user?.id
  const daveId = (await d('/api/me')).body?.user?.id
  assert.ok(carolId && daveId, 'could not read Carol/Dave ids')
  const carolRequest = await c('/api/friends', { method: 'POST', body: JSON.stringify({ action: 'request', targetId: daveId }) })
  assert.ok([200, 201].includes(carolRequest.status), `friend request failed: ${carolRequest.status} ${carolRequest.text}`)
  const daveAccept = await d(`/api/friends/request/${carolId}/accept`, { method: 'POST' })
  assert.ok([200, 204].includes(daveAccept.status), `friend accept failed: ${daveAccept.status} ${daveAccept.text}`)

  const sent = await c('/api/messages', {
    method: 'POST',
    body: JSON.stringify({ receiverId: daveId, content: 'did you see this?' }),
  })
  assert.equal(sent.status, 200, JSON.stringify(sent.body))
  const sentId = sent.body?.message?.id

  const disable = await d('/api/users/me', {
    method: 'PUT',
    body: JSON.stringify({ readReceipts: false }),
  })
  assert.ok([200, 204].includes(disable.status), `could not disable read receipts: ${disable.status} ${disable.text}`)

  // Dave reads the thread. The messages must stay in their pre-read state.
  const readAsDave = await d(`/api/messages?userId=${carolId}`)
  assert.equal(readAsDave.status, 200)

  const carolView = await c(`/api/messages?userId=${daveId}`)
  assert.equal(carolView.status, 200)
  const seenMessage = (carolView.body?.messages || []).find((m) => m.id === sentId)
  assert.ok(seenMessage, 'Carol must still see her own message')
  assert.notEqual(
    seenMessage.status,
    'SEEN',
    'with read receipts disabled, opening the thread must not tell the sender it was read',
  )

  // Control: with receipts back on, the same read *does* mark it seen.
  await d('/api/users/me', { method: 'PUT', body: JSON.stringify({ readReceipts: true }) })
  await d(`/api/messages?userId=${carolId}`)
  const carolView2 = await c(`/api/messages?userId=${daveId}`)
  const seenMessage2 = (carolView2.body?.messages || []).find((m) => m.id === sentId)
  assert.equal(
    seenMessage2?.status,
    'SEEN',
    'with read receipts enabled, reading the thread must still mark the message seen',
  )

  // ===== finding #9: cancelling a scheduled message keeps an audit trail =====
  const future = new Date(Date.now() + 3_600_000).toISOString()
  const scheduled = await a('/api/messages/scheduled', {
    method: 'POST',
    body: JSON.stringify({ receiverId: bobId, content: 'later', scheduledFor: future }),
  })
  assert.equal(scheduled.status, 200, JSON.stringify(scheduled.body))
  const scheduledId = scheduled.body?.message?.id
  assert.ok(scheduledId, 'scheduled message id missing')

  // The list endpoint returns `{ scheduled: [...] }`, and a cancelled row keeps
  // its future `scheduledFor`, so the status filter is what excludes it.
  const listBefore = await a('/api/messages/scheduled')
  assert.equal(listBefore.status, 200)
  assert.ok(
    (listBefore.body?.scheduled || []).some((m) => m.id === scheduledId),
    'a pending scheduled message must be listed',
  )

  const cancel = await a(`/api/messages/scheduled?id=${scheduledId}`, { method: 'DELETE' })
  assert.equal(cancel.status, 200, `cancel failed: ${cancel.status} ${cancel.text}`)
  assert.equal(cancel.body?.status, 'cancelled')

  const listAfter = await a('/api/messages/scheduled')
  assert.equal(listAfter.status, 200)
  assert.ok(
    !(listAfter.body?.scheduled || []).some((m) => m.id === scheduledId),
    'a cancelled message must no longer be listed as pending',
  )

  // Cancelling twice is idempotent, not an error, and never resurrects the row.
  const cancelAgain = await a(`/api/messages/scheduled?id=${scheduledId}`, { method: 'DELETE' })
  assert.equal(cancelAgain.status, 200)
  assert.equal(cancelAgain.body?.alreadyCancelled, true)

  // Bob must never receive a cancelled message, even once its time passes: the
  // delivery job only sends rows still in status SENT.
  const bobThread = await b(`/api/messages?userId=${(await a('/api/me')).body?.user?.id}`)
  assert.equal(bobThread.status, 200)
  assert.ok(
    !(bobThread.body?.messages || []).some((m) => m.id === scheduledId),
    'a cancelled scheduled message must never be delivered',
  )

  // ===== finding #9 (scheduling is not a block bypass) =====
  await a('/api/friends', { method: 'POST', body: JSON.stringify({ action: 'request', targetId: bobId }) })
  await b(`/api/friends/request/${(await a('/api/me')).body?.user?.id}/accept`, { method: 'POST' })
  await b('/api/friends', { method: 'POST', body: JSON.stringify({ action: 'block', targetId: (await a('/api/me')).body?.user?.id }) })

  const blockedSchedule = await a('/api/messages/scheduled', {
    method: 'POST',
    body: JSON.stringify({ receiverId: bobId, content: 'sneaking past the block', scheduledFor: future }),
  })
  assert.equal(
    blockedSchedule.status,
    403,
    `a blocked user must not be able to schedule a message, got ${blockedSchedule.status}`,
  )
})
