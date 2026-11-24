'use strict'

/**
 * Friendship lifecycle, end-to-end against a real Next server and a real
 * isolated SQLite database.
 *
 * Covers finding #1: before this, `POST /api/friends {action:'request'}` wrote a
 * FriendRequest row that no read path consulted, and the accept/cancel
 * endpoints did not exist at all — so a 404 was reported to the user as
 * "Friend request accepted" and nobody could ever become friends.
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
    if (child.exitCode !== null) throw new Error(`Next server exited early (${child.exitCode})\n${output()}`)
    try {
      const response = await fetch(`${url}/api/health`)
      if (response.status < 500) return
    } catch {}
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`Next server health timeout\n${output()}`)
}

async function registerAndLogin(base, name) {
  const jar = new Map()
  const suffix = `${name}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`.toLowerCase()
  const credentials = {
    name,
    username: suffix,
    email: `${suffix}@security.invalid`,
    password: 'ValidPassw0rd!',
  }
  const register = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(credentials),
  })
  const registerText = await register.text()
  assert.equal(register.status, 201, `register failed: ${registerText}`)
  let registered = null
  try {
    registered = JSON.parse(registerText)
  } catch {}

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
  const login = await fetch(`${base}/api/auth/callback/credentials`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookieHeader(jar) },
    body: form,
  })
  collectCookies(login, jar)
  assert.ok(
    [200, 302].includes(login.status),
    `credentials callback status ${login.status}: ${await login.text()}`,
  )
  assert.ok(
    Array.from(jar.keys()).some((key) => key.includes('session-token')),
    'session cookie was not set',
  )
  return { jar, credentials, id: registered?.user?.id }
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
    return { status: response.status, body }
  }
}

test('friend request lifecycle: request, accept, list, remove', { timeout: 120_000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'friendconnect-friends-'))
  const dbFile = join(root, 'friends.sqlite')
  const uploadPath = join(root, 'uploads')
  const appPort = await freePort()
  const socketPort = await freePort()
  const base = `http://127.0.0.1:${appPort}`

  const env = {
    ...process.env,
    NODE_ENV: 'production',
    DATABASE_URL: `file:${dbFile}`,
    NEXTAUTH_SECRET: 'integration-only-not-a-production-secret',
    NEXTAUTH_URL: base,
    APP_ORIGIN: base,
    APP_DIR: repo,
    UPLOAD_DIR: uploadPath,
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
    await rm(root, { recursive: true, force: true })
  })

  await waitHealthy(base, app, () => logs)

  const alice = await registerAndLogin(base, 'Alice')
  const bob = await registerAndLogin(base, 'Bob')
  const a = client(base, alice.jar)
  const b = client(base, bob.jar)

  const aliceId = (await a('/api/me')).body?.user?.id
  const bobId = (await b('/api/me')).body?.user?.id
  assert.ok(aliceId && bobId, 'register/login must expose the user id')

  // --- unauthenticated access is refused -----------------------------------
  assert.equal((await fetch(`${base}/api/friends`)).status, 401)

  // --- request -------------------------------------------------------------
  const requested = await a('/api/friends', {
    method: 'POST',
    body: JSON.stringify({ action: 'request', targetId: bobId }),
  })
  assert.equal(requested.status, 200, JSON.stringify(requested.body))
  assert.equal(requested.body.status, 'PENDING')
  assert.equal(requested.body.changed, true)

  // Repeating a request is idempotent, not an error.
  const repeated = await a('/api/friends', {
    method: 'POST',
    body: JSON.stringify({ action: 'request', targetId: bobId }),
  })
  assert.equal(repeated.status, 200)
  assert.equal(repeated.body.changed, false)

  // Self-requests are rejected.
  const self = await a('/api/friends', {
    method: 'POST',
    body: JSON.stringify({ action: 'request', targetId: aliceId }),
  })
  assert.equal(self.status, 400)
  assert.equal(self.body.code, 'SELF_TARGET')

  // --- the recipient sees it ----------------------------------------------
  const bobRequests = await b('/api/friends/requests')
  assert.equal(bobRequests.status, 200)
  assert.equal(bobRequests.body.incoming.length, 1)
  assert.equal(bobRequests.body.incoming[0].id, aliceId, 'incoming id must be the other user id')
  assert.equal(bobRequests.body.outgoing.length, 0)

  const aliceRequests = await a('/api/friends/requests')
  assert.equal(aliceRequests.body.outgoing.length, 1)
  assert.equal(aliceRequests.body.outgoing[0].id, bobId)

  // /api/friends exposes the same pending state (Sidebar + FriendsView).
  const aliceList = await a('/api/friends')
  assert.equal(aliceList.status, 200)
  assert.deepEqual(aliceList.body.friends, [])
  assert.equal(aliceList.body.sent.length, 1)
  assert.equal(aliceList.body.sent[0].id, bobId)
  assert.equal(aliceList.body.received.length, 0)

  // --- the sender cannot accept their own request -------------------------
  const selfAccept = await a(`/api/friends/request/${bobId}/accept`, { method: 'POST' })
  assert.equal(selfAccept.status, 403, JSON.stringify(selfAccept.body))

  // --- accept --------------------------------------------------------------
  const accepted = await b(`/api/friends/request/${aliceId}/accept`, { method: 'POST' })
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body))
  assert.equal(accepted.body.status, 'ACCEPTED')
  assert.equal(accepted.body.changed, true)

  // Accepting twice is idempotent.
  const acceptedAgain = await b(`/api/friends/request/${aliceId}/accept`, { method: 'POST' })
  assert.equal(acceptedAgain.status, 200)
  assert.equal(acceptedAgain.body.changed, false)

  // --- both sides now list each other as friends ---------------------------
  const aliceFriends = await a('/api/friends')
  assert.equal(aliceFriends.body.friends.length, 1)
  assert.equal(aliceFriends.body.friends[0].id, bobId)
  assert.equal(aliceFriends.body.sent.length, 0, 'accepted requests leave the pending list')
  assert.equal(aliceFriends.body.received.length, 0)

  const bobFriends = await b('/api/friends')
  assert.equal(bobFriends.body.friends.length, 1)
  assert.equal(bobFriends.body.friends[0].id, aliceId)

  // The profile view reports the relationship so the UI can render it.
  const bobProfile = await a(`/api/users/${bobId}`)
  assert.equal(bobProfile.status, 200)
  assert.equal(bobProfile.body.relation.isFriend, true)
  assert.equal(bobProfile.body.relation.status, 'ACCEPTED')
  assert.equal(bobProfile.body.relation.incomingRequest, false)

  // --- cancel: a second request can be withdrawn ---------------------------
  const carol = await registerAndLogin(base, 'Carol')
  const c = client(base, carol.jar)
  const carolId = (await c('/api/me')).body?.user?.id
  await a('/api/friends', { method: 'POST', body: JSON.stringify({ action: 'request', targetId: carolId }) })
  assert.equal((await c('/api/friends/requests')).body.incoming.length, 1)

  const cancelled = await a(`/api/friends/request/${carolId}/cancel`, { method: 'POST' })
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body))
  assert.equal(cancelled.body.status, 'NONE')
  assert.equal((await c('/api/friends/requests')).body.incoming.length, 0, 'cancel must clear the incoming request')

  // Cancelling again is a no-op, not a 404.
  assert.equal((await a(`/api/friends/request/${carolId}/cancel`, { method: 'POST' })).status, 200)

  // --- reject --------------------------------------------------------------
  await a('/api/friends', { method: 'POST', body: JSON.stringify({ action: 'request', targetId: carolId }) })
  const rejected = await c(`/api/friends/request/${aliceId}/reject`, { method: 'POST' })
  assert.equal(rejected.status, 200, JSON.stringify(rejected.body))
  assert.equal(rejected.body.status, 'REJECTED')
  assert.equal((await c('/api/friends/requests')).body.incoming.length, 0)
  assert.equal((await a('/api/friends')).body.friends.length, 1, 'a rejected request must not create a friendship')

  // A rejected pair can try again.
  const retried = await a('/api/friends', {
    method: 'POST',
    body: JSON.stringify({ action: 'request', targetId: carolId }),
  })
  assert.equal(retried.status, 200)
  assert.equal(retried.body.status, 'PENDING')

  // --- block hides the request and prevents new ones ----------------------
  const blocked = await c('/api/friends', {
    method: 'POST',
    body: JSON.stringify({ action: 'block', targetId: aliceId }),
  })
  assert.equal(blocked.status, 200, JSON.stringify(blocked.body))
  assert.equal(blocked.body.status, 'BLOCKED')

  const blockedList = await c('/api/friends/blocked')
  assert.equal(blockedList.status, 200)
  assert.ok(blockedList.body.blocked.some((entry) => entry.id === aliceId))

  // Alice cannot re-request someone who blocked her.
  const afterBlock = await a('/api/friends', {
    method: 'POST',
    body: JSON.stringify({ action: 'request', targetId: carolId }),
  })
  assert.ok([403, 409].includes(afterBlock.status), `expected refusal, got ${afterBlock.status}`)

  // The block also removes the pending request from Alice's view.
  assert.equal((await a('/api/friends')).body.sent.length, 0)

  const unblocked = await c('/api/friends', {
    method: 'POST',
    body: JSON.stringify({ action: 'unblock', targetId: aliceId }),
  })
  assert.equal(unblocked.status, 200)
  assert.equal((await c('/api/friends/blocked')).body.blocked.length, 0)

  // --- remove --------------------------------------------------------------
  const removed = await a('/api/friends', {
    method: 'POST',
    body: JSON.stringify({ action: 'remove', targetId: bobId }),
  })
  assert.equal(removed.status, 200, JSON.stringify(removed.body))
  assert.equal(removed.body.status, 'NONE')
  assert.equal((await a('/api/friends')).body.friends.length, 0)
  assert.equal((await b('/api/friends')).body.friends.length, 0, 'removal is symmetric')

  // DELETE route does the same thing.
  await a('/api/friends', { method: 'POST', body: JSON.stringify({ action: 'request', targetId: bobId }) })
  await b(`/api/friends/request/${aliceId}/accept`, { method: 'POST' })
  assert.equal((await a('/api/friends')).body.friends.length, 1)
  assert.equal((await a(`/api/friends/${bobId}`, { method: 'DELETE' })).status, 200)
  assert.equal((await a('/api/friends')).body.friends.length, 0)

  // --- unknown actions and missing targets are rejected -------------------
  assert.equal(
    (await a('/api/friends', { method: 'POST', body: JSON.stringify({ action: 'destroy', targetId: bobId }) })).status,
    400,
  )
  assert.equal(
    (await a('/api/friends', { method: 'POST', body: JSON.stringify({ action: 'request' }) })).status,
    400,
  )
  assert.equal(
    (await a('/api/friends', { method: 'POST', body: JSON.stringify({ action: 'request', targetId: 'nope' }) })).status,
    404,
  )

  // --- no database internals leak into responses --------------------------
  const leak = JSON.stringify(
    (await a('/api/friends', { method: 'POST', body: JSON.stringify({ action: 'request', targetId: 'nope' }) })).body,
  )
  assert.ok(!/sqlite|prisma|constraint|SELECT|at .*:\d+:\d+/i.test(leak), `response leaked internals: ${leak}`)
})
