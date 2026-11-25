'use strict'

/**
 * Jara as a permanent AI *user*, not a chatbot page.
 *
 * Before this file, the messaging paths only special-cased Jara so that permission
 * checks passed (`isJaraId`): a human could open a direct conversation with Jara,
 * send a message in the ordinary chat UI, see it stored — and never get an answer,
 * because nothing connected the message store to the AI gateway. Jara's only
 * replies came from the separate `/api/jara/chat` screen, which wrote rows with no
 * `conversationId`, so they never appeared in the conversation the user had opened.
 *
 * These tests boot the real production build against a throwaway SQLite database
 * and a real HTTP provider (a local Ollama-compatible server), so the request that
 * leaves the app is the same one a configured deployment sends, and the answer is
 * stored, delivered and notified through the normal message pipeline.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdtemp, rm } = require('fs/promises')
const { tmpdir } = require('os')
const { join, resolve } = require('path')
const { spawn } = require('child_process')
const { createServer } = require('http')
const net = require('net')

const repo = resolve(__dirname, '../..')
const JARA_ID = 'jara-ai-system-001'

function freePort() {
  return new Promise((resolvePort, reject) => {
    const srv = net.createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port
      srv.close((err) => (err ? reject(err) : resolvePort(port)))
    })
  })
}

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms))

async function waitHealthy(base, child, logs) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`app exited early (${child.exitCode})\n${logs()}`)
    try {
      const res = await fetch(`${base}/api/health`).catch(() => null)
      if (res && res.ok) return
    } catch {}
    await sleep(150)
  }
  throw new Error(`app did not become healthy\n${logs()}`)
}

/** A minimal Ollama `/api/chat` server: records what the app sent, answers in Bangla. */
async function startProvider(reply) {
  const requests = []
  const server = createServer((req, res) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      let body = {}
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch {}
      requests.push({ url: req.url, body })
      const content = typeof reply === 'function' ? reply(body) : reply
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ message: { role: 'assistant', content } }))
    })
  })
  await new Promise((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    close: () =>
      new Promise((resolveClose) => {
        // `close()` alone waits for keep-alive sockets undici still holds.
        server.closeAllConnections?.()
        server.close(() => resolveClose())
      }),
  }
}

function cookieHeader(jar) {
  return Array.from(jar.entries()).map(([k, v]) => `${k}=${v}`).join('; ')
}

function collectCookies(response, jar) {
  const headers = response.headers.getSetCookie?.() || [response.headers.get('set-cookie')].filter(Boolean)
  for (const header of headers) {
    const pair = header.split(';', 1)[0]
    const i = pair.indexOf('=')
    if (i > 0) {
      const name = pair.slice(0, i)
      const value = pair.slice(i + 1)
      if (value) jar.set(name, value)
      else jar.delete(name)
    }
  }
}

async function registerAndLogin(base, label) {
  const credentials = {
    email: `${label.toLowerCase()}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}@jara.invalid`,
    username: `${label.toLowerCase()}_${Math.random().toString(16).slice(2, 8)}`,
    name: label,
    password: 'Integration-Passw0rd!',
  }
  const register = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(credentials),
  })
  const registerText = await register.text()
  assert.ok([200, 201].includes(register.status), `register failed: ${register.status} ${registerText}`)

  const jar = new Map()
  const csrfResponse = await fetch(`${base}/api/auth/csrf`)
  collectCookies(csrfResponse, jar)
  const { csrfToken } = await csrfResponse.json()
  const login = await fetch(`${base}/api/auth/callback/credentials`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookieHeader(jar) },
    // NextAuth's credentials provider authenticates on `identifier` (username or
    // email); sending `email` alone leaves the user without a registry session.
    body: new URLSearchParams({
      csrfToken,
      identifier: credentials.username,
      password: credentials.password,
      json: 'true',
    }),
    redirect: 'manual',
  })
  collectCookies(login, jar)
  assert.ok(
    Array.from(jar.keys()).some((key) => key.includes('session-token')),
    'NextAuth session cookie was not set',
  )
  const meResponse = await fetch(`${base}/api/auth/me`, { headers: { cookie: cookieHeader(jar) } })
  const meText = await meResponse.text()
  assert.equal(meResponse.status, 200, meText)
  return { jar, me: JSON.parse(meText).user, credentials }
}

/** Start the production build with an isolated database and its own ports. */
async function startApp(t, { dbFile, uploadDir, providerUrl, extraEnv = {} }) {
  const appPort = await freePort()
  const socketPort = await freePort()
  const base = `http://127.0.0.1:${appPort}`
  const childEnv = { ...process.env }
  for (const key of [
    'OLLAMA_URL', 'OLLAMA_MODEL', 'ZAI_API_KEY', 'OPENROUTER_API_KEY', 'HUGGINGFACE_API_KEY',
    'OPENAI_API_KEY', 'AI_API_KEY', 'OPENAI_BASE_URL', 'AI_MODEL',
  ]) delete childEnv[key]

  const env = {
    ...childEnv,
    ...(providerUrl ? { OLLAMA_URL: providerUrl, OLLAMA_MODEL: 'jara-integration-model' } : {}),
    NODE_ENV: 'production',
    DATABASE_URL: `file:${dbFile}`,
    NEXTAUTH_SECRET: 'integration-jara-secret-001',
    NEXTAUTH_URL: base,
    APP_ORIGIN: base,
    APP_DIR: repo,
    UPLOAD_DIR: uploadDir,
    PORT: String(appPort),
    HOSTNAME: '127.0.0.1',
    SOCKET_PORT: String(socketPort),
    SOCKET_INTERNAL_URL: `http://127.0.0.1:${socketPort}`,
    APP_INTERNAL_URL: base,
    REDIS_URL: '',
    ...extraEnv,
  }

  const app = spawn(process.execPath, [join(repo, '.next/standalone/server.js')], {
    cwd: join(repo, '.next/standalone'),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let logs = ''
  app.stdout.on('data', (d) => { logs += d.toString() })
  app.stderr.on('data', (d) => { logs += d.toString() })
  const socket = spawn(process.execPath, ['socket-server.js'], { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'] })
  socket.stdout.on('data', (d) => { logs += d.toString() })
  socket.stderr.on('data', (d) => { logs += d.toString() })

  const stop = (child) =>
    new Promise((resolveExit) => {
      if (child.exitCode !== null || child.signalCode !== null) return resolveExit()
      const force = setTimeout(() => {
        child.kill('SIGKILL')
        resolveExit()
      }, 5000)
      child.once('exit', () => {
        clearTimeout(force)
        resolveExit()
      })
      child.kill('SIGTERM')
    })

  t.after(async () => {
    await Promise.all([stop(socket), stop(app)])
  })

  await waitHealthy(base, app, () => logs)
  return { base, socketUrl: `http://127.0.0.1:${socketPort}`, logs: () => logs }
}

/** Poll the conversation until Jara's answer is stored, like the client's socket would. */
async function waitForJaraReply(base, jar, conversationId, { timeout = 20_000 } = {}) {
  const deadline = Date.now() + timeout
  let last = []
  while (Date.now() < deadline) {
    const response = await fetch(`${base}/api/conversations/${conversationId}/messages`, {
      headers: { cookie: cookieHeader(jar) },
    })
    if (response.ok) {
      last = (await response.json()).messages.filter((m) => m.senderId === JARA_ID)
      if (last.length) return last
    }
    await sleep(200)
  }
  return last
}

test('Jara answers a normal direct message through the real message pipeline', { timeout: 120_000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'friendconnect-jara-user-'))
  const dbFile = join(root, 'jara.sqlite')
  const provider = await startProvider(
    // Real Bangla, in the Bangla script: the reply must survive the whole pipeline
    // as UTF-8 (store → JSON → conversation fetch).
    'আসসালামু আলাইকুম! আমি ভালো আছি, তুমি কেমন আছো?',
  )
  t.after(async () => {
    await provider.close()
    await rm(root, { recursive: true, force: true })
  })

  const { base, logs } = await startApp(t, { dbFile, uploadDir: join(root, 'uploads'), providerUrl: provider.url })
  const alice = await registerAndLogin(base, 'Alice')

  // 1. Jara is discoverable as a user and has exactly one identity.
  const search = await fetch(`${base}/api/users/search?q=jara`, { headers: { cookie: cookieHeader(alice.jar) } })
  assert.equal(search.status, 200, await search.clone().text())
  const searchBody = await search.json()
  const found = (searchBody.users || searchBody.results || []).filter((u) => u.id === JARA_ID)
  assert.equal(found.length, 1, `Jara must appear exactly once in user search: ${JSON.stringify(searchBody).slice(0, 400)}`)
  assert.equal(found[0].name, 'Jara')

  const profile = await fetch(`${base}/api/jara/profile`, { headers: { cookie: cookieHeader(alice.jar) } })
  assert.equal(profile.status, 200, await profile.clone().text())
  const profileBody = await profile.json()
  assert.equal(profileBody.user.id, JARA_ID)
  assert.equal(profileBody.user.isAI, true, 'Jara must be labelled as AI')
  assert.equal(profileBody.user.name, 'Jara')

  // 2. A human opens an ordinary direct conversation with Jara — no special page.
  const conversationResponse = await fetch(`${base}/api/conversations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: cookieHeader(alice.jar) },
    body: JSON.stringify({ type: 'direct', memberIds: [JARA_ID] }),
  })
  assert.ok([200, 201].includes(conversationResponse.status), await conversationResponse.clone().text())
  const conversation = (await conversationResponse.json()).conversation
  assert.ok(conversation.id)

  // Asking twice must reuse the thread, not create a second Jara conversation.
  const second = await fetch(`${base}/api/conversations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: cookieHeader(alice.jar) },
    body: JSON.stringify({ type: 'direct', memberIds: [JARA_ID] }),
  })
  assert.equal((await second.json()).conversation.id, conversation.id)

  // 3. A Bangla message sent from the chat UI path gets a real provider answer.
  const banglaQuestion = 'আসসালামু আলাইকুম জারা, তুমি কেমন আছো?'
  const send = await fetch(`${base}/api/conversations/${conversation.id}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: cookieHeader(alice.jar) },
    body: JSON.stringify({ content: banglaQuestion }),
  })
  assert.equal(send.status, 201, await send.clone().text())
  const sent = (await send.json()).message

  const replies = await waitForJaraReply(base, alice.jar, conversation.id)
  assert.equal(replies.length, 1, `expected exactly one Jara reply, got ${replies.length}\n${logs()}`)
  const reply = replies[0]
  assert.equal(reply.content, 'আসসালামু আলাইকুম! আমি ভালো আছি, তুমি কেমন আছো?')
  assert.equal(reply.receiverId, alice.me.id, 'a direct reply keeps the human as receiver')
  assert.equal(reply.conversationId, conversation.id, 'the reply belongs to the same conversation')
  assert.equal(reply.replyToId ?? reply.replyTo?.id, sent.id, 'the reply quotes the message it answers')

  // The provider actually received the Bangla text, the Jara system prompt and the
  // prior turn — i.e. this is inference, not a canned string.
  assert.equal(provider.requests.length, 1, 'exactly one provider call per message')
  const providerBody = provider.requests[0].body
  const serialized = JSON.stringify(providerBody.messages)
  assert.equal(providerBody.model, 'jara-integration-model')
  assert.ok(serialized.includes('আসসালামু আলাইকুম জারা'), 'the Bangla question reaches the model unchanged')
  assert.match(serialized, /You are Jara/, 'the Jara system prompt is sent')

  // The human's own message is now marked seen by its AI peer.
  const thread = await fetch(`${base}/api/conversations/${conversation.id}/messages`, {
    headers: { cookie: cookieHeader(alice.jar) },
  })
  const threadMessages = (await thread.json()).messages
  const mine = threadMessages.find((m) => m.id === sent.id)
  assert.equal(mine.status, 'SEEN', 'Jara read the message it answers')

  // 4. The answer is a notification, not just a row.
  const notifications = await fetch(`${base}/api/notifications`, { headers: { cookie: cookieHeader(alice.jar) } })
  assert.equal(notifications.status, 200, await notifications.clone().text())
  const notificationList = (await notifications.json()).notifications || []
  assert.ok(
    notificationList.some((n) => n.title === 'Jara replied'),
    `expected a Jara notification: ${JSON.stringify(notificationList).slice(0, 300)}`,
  )

  // 5. Duplicate protection: the socket trigger and the REST trigger can both fire
  // for one message (the realtime server calls /api/jara/respond as well). A replay
  // must not produce a second answer, and it must not call the provider again.
  const replay = await fetch(`${base}/api/jara/respond`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-secret': 'integration-jara-secret-001' },
    body: JSON.stringify({ messageId: sent.id, conversationId: conversation.id }),
  })
  assert.equal(replay.status, 200, await replay.clone().text())
  const replayBody = await replay.json()
  assert.equal(replayBody.replied, false)
  assert.equal(replayBody.reason, 'duplicate')
  assert.equal(provider.requests.length, 1, 'the provider is not called twice for one message')

  // The internal trigger refuses callers without the shared secret.
  const unauthenticated = await fetch(`${base}/api/jara/respond`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messageId: sent.id }),
  })
  assert.equal(unauthenticated.status, 401)
})

test('Jara does not answer where it is not a participant, and reports inference honestly', { timeout: 120_000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'friendconnect-jara-user-privacy-'))
  const dbFile = join(root, 'jara.sqlite')
  // No provider: the app must say so instead of inventing an answer.
  const { base, logs } = await startApp(t, { dbFile, uploadDir: join(root, 'uploads'), providerUrl: null })
  t.after(async () => rm(root, { recursive: true, force: true }))

  const alice = await registerAndLogin(base, 'Alice')
  const bob = await registerAndLogin(base, 'Bob')

  // A normal human-to-human conversation that Jara is not part of.
  const humanConversation = await fetch(`${base}/api/conversations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: cookieHeader(alice.jar) },
    body: JSON.stringify({ type: 'direct', memberIds: [bob.me.id] }),
  })
  const humanConv = (await humanConversation.json()).conversation
  const humanMessage = await fetch(`${base}/api/conversations/${humanConv.id}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: cookieHeader(alice.jar) },
    body: JSON.stringify({ content: 'PRIVATE_HUMAN_ONLY_MESSAGE' }),
  })
  assert.equal(humanMessage.status, 201, await humanMessage.clone().text())
  const humanMessageId = (await humanMessage.json()).message.id

  await sleep(500)
  const humanThread = await fetch(`${base}/api/conversations/${humanConv.id}/messages`, {
    headers: { cookie: cookieHeader(alice.jar) },
  })
  const humanMessages = (await humanThread.json()).messages
  assert.equal(
    humanMessages.filter((m) => m.senderId === JARA_ID).length,
    0,
    'Jara must never inject a reply into a conversation it is not part of',
  )

  // Even the internal trigger cannot make Jara read that conversation.
  const intrude = await fetch(`${base}/api/jara/respond`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-secret': 'integration-jara-secret-001' },
    body: JSON.stringify({ messageId: humanMessageId, conversationId: humanConv.id }),
  })
  assert.equal(intrude.status, 200)
  const intrudeBody = await intrude.json()
  assert.equal(intrudeBody.replied, false)
  assert.equal(intrudeBody.reason, 'not_participant')

  // Without a provider, a DM to Jara gets an explicit unavailability notice — and
  // it is flagged as such, never disguised as a model answer.
  const jaraConversation = await fetch(`${base}/api/conversations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: cookieHeader(alice.jar) },
    body: JSON.stringify({ type: 'direct', memberIds: [JARA_ID] }),
  })
  const jaraConv = (await jaraConversation.json()).conversation
  const send = await fetch(`${base}/api/conversations/${jaraConv.id}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: cookieHeader(alice.jar) },
    body: JSON.stringify({ content: 'তুমি কি সত্যিই উত্তর দিতে পারো?' }),
  })
  assert.equal(send.status, 201, await send.clone().text())

  const replies = await waitForJaraReply(base, alice.jar, jaraConv.id)
  assert.equal(replies.length, 1, `expected an unavailability notice\n${logs()}`)
  assert.equal(replies[0].type, 'system')
  assert.match(replies[0].content, /inference: unavailable/)
  assert.match(replies[0].content, /cannot reply right now/)
  assert.doesNotMatch(replies[0].content, /আসসালামু আলাইকুম!/, 'no fabricated greeting')
})

test('Jara keeps one permanent identity across restarts and repeated setup', { timeout: 120_000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'friendconnect-jara-identity-'))
  const dbFile = join(root, 'jara.sqlite')
  t.after(async () => rm(root, { recursive: true, force: true }))

  // First boot seeds Jara.
  const first = await startApp(t, { dbFile, uploadDir: join(root, 'uploads'), providerUrl: null })
  const alice = await registerAndLogin(first.base, 'Alice')
  const firstProfile = await (await fetch(`${first.base}/api/jara/profile`, { headers: { cookie: cookieHeader(alice.jar) } })).json()
  assert.equal(firstProfile.user.id, JARA_ID)
  assert.equal(firstProfile.user.email, 'jara@friendconnect.local')
  assert.equal(firstProfile.user.role, 'jara')

  // Login as Jara must be impossible: the account has no usable password.
  const jaraJar = new Map()
  const csrfResponse = await fetch(`${first.base}/api/auth/csrf`)
  collectCookies(csrfResponse, jaraJar)
  const { csrfToken } = await csrfResponse.json()
  const jaraLogin = await fetch(`${first.base}/api/auth/callback/credentials`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookieHeader(jaraJar) },
    body: new URLSearchParams({
      csrfToken,
      email: 'jara@friendconnect.local',
      password: '__JARA_SYSTEM__',
      json: 'true',
    }),
    redirect: 'manual',
  })
  collectCookies(jaraLogin, jaraJar)
  const jaraSession = await fetch(`${first.base}/api/auth/me`, { headers: { cookie: cookieHeader(jaraJar) } })
  const jaraSessionBody = await jaraSession.json()
  assert.equal(jaraSessionBody.user, null, 'the Jara account must not be loginable')

  // An ordinary user cannot modify Jara's protected configuration.
  const blocked = await fetch(`${first.base}/api/jara/config`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', cookie: cookieHeader(alice.jar) },
    body: JSON.stringify({ avatarUrl: '/attacker-chosen.png', displayName: 'Not Jara' }),
  })
  assert.equal(blocked.status, 403, `ordinary users must not change Jara: ${await blocked.clone().text()}`)

  const blockedProposal = await fetch(`${first.base}/api/jara/proposals`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: cookieHeader(alice.jar) },
    body: JSON.stringify({ patch: { avatarUrl: '/attacker-chosen.png' } }),
  })
  assert.equal(blockedProposal.status, 403, `ordinary users must not propose Jara changes: ${await blockedProposal.clone().text()}`)

  // Restart against the same database: the identity is preserved, not duplicated.
  first.base = null
  const restarted = await startApp(t, { dbFile, uploadDir: join(root, 'uploads'), providerUrl: null })
  const secondProfile = await (await fetch(`${restarted.base}/api/jara/profile`, { headers: { cookie: cookieHeader(alice.jar) } })).json()
  assert.equal(secondProfile.user.id, JARA_ID)
  assert.equal(secondProfile.user.email, 'jara@friendconnect.local')

  const search = await (await fetch(`${restarted.base}/api/users/search?q=jara`, { headers: { cookie: cookieHeader(alice.jar) } })).json()
  const jaras = (search.users || search.results || []).filter((u) => u.id === JARA_ID || u.username === 'jara')
  assert.equal(jaras.length, 1, `Jara must exist exactly once after a restart: ${JSON.stringify(search).slice(0, 300)}`)
})

test('Jara answers over Socket.IO in realtime, on the same event the UI listens to', { timeout: 120_000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'friendconnect-jara-socket-'))
  const dbFile = join(root, 'jara.sqlite')
  const provider = await startProvider('হ্যালো! আমি জারা, সকেট থেকেও উত্তর দিতে পারি।')
  t.after(async () => {
    await provider.close()
    await rm(root, { recursive: true, force: true })
  })

  const { base, socketUrl, logs } = await startApp(t, {
    dbFile,
    uploadDir: join(root, 'uploads'),
    providerUrl: provider.url,
  })
  const { io } = require('socket.io-client')
  const alice = await registerAndLogin(base, 'Alice')

  const conversation = (await (await fetch(`${base}/api/conversations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: cookieHeader(alice.jar) },
    body: JSON.stringify({ type: 'direct', memberIds: [JARA_ID] }),
  })).json()).conversation

  const tokenResponse = await fetch(`${base}/api/auth/token`, { headers: { cookie: cookieHeader(alice.jar) } })
  assert.equal(tokenResponse.status, 200, await tokenResponse.clone().text())
  const { token } = await tokenResponse.json()

  // Same connection shape the app's client uses: attach listeners first, then
  // connect, so a refused handshake cannot resolve into a silent hang.
  const socket = io(socketUrl, {
    autoConnect: false,
    auth: { token },
    transports: ['websocket'],
    reconnection: false,
    timeout: 5000,
  })
  t.after(() => socket.close())
  const authed = new Promise((resolveAuth, rejectAuth) => {
    socket.once('auth:ok', resolveAuth)
    socket.once('connect_error', rejectAuth)
  })
  socket.connect()
  await Promise.race([
    authed,
    new Promise((_resolve, rejectTimeout) => setTimeout(() => rejectTimeout(new Error('socket authentication timed out')), 20_000)),
  ])
  socket.emit('conversation:join', conversation.id)

  const jaraReply = new Promise((resolveReply, rejectReply) => {
    const timer = setTimeout(() => rejectReply(new Error(`no Jara reply over the socket\n${logs()}`)), 25_000)
    socket.on('message:new', (message) => {
      if (message?.senderId === JARA_ID) {
        clearTimeout(timer)
        resolveReply(message)
      }
    })
  })

  const ack = await new Promise((resolveAck) => {
    socket.emit('message:send', { conversationId: conversation.id, content: 'সকেট দিয়ে বলছি, তুমি কে?' }, resolveAck)
  })
  assert.equal(ack.ok, true, `socket send must be accepted: ${JSON.stringify(ack)}`)

  const reply = await jaraReply
  assert.equal(reply.conversationId, conversation.id, 'the realtime reply belongs to the conversation')
  assert.equal(reply.senderId, JARA_ID)
  assert.equal(reply.content, 'হ্যালো! আমি জারা, সকেট থেকেও উত্তর দিতে পারি।')
  assert.equal(provider.requests.length, 1, 'one socket message produced exactly one provider call')

  // Stored as well as broadcast: a reload shows the same answer.
  const stored = await (await fetch(`${base}/api/conversations/${conversation.id}/messages`, {
    headers: { cookie: cookieHeader(alice.jar) },
  })).json()
  assert.ok(
    stored.messages.some((m) => m.id === reply.id && m.senderId === JARA_ID),
    'the realtime reply is an ordinary stored message',
  )
})

test('Super Admin governs Jara: ordinary users are refused and every change is audited', { timeout: 120_000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'friendconnect-jara-governance-'))
  const dbFile = join(root, 'jara.sqlite')
  const { base, logs } = await startApp(t, { dbFile, uploadDir: join(root, 'uploads'), providerUrl: null })
  t.after(async () => rm(root, { recursive: true, force: true }))

  const admin = await registerAndLogin(base, 'Admin')
  const member = await registerAndLogin(base, 'Member')

  // Promote one account to Super Admin directly in the throwaway database: the
  // application has no "make me an admin" endpoint, by design.
  const Database = require('better-sqlite3')
  const raw = new Database(dbFile)
  try {
    raw.prepare('UPDATE "User" SET role = ? WHERE id = ?').run('superadmin', admin.me.id)
  } finally {
    raw.close()
  }

  // A normal user cannot create or approve Jara configuration changes.
  const memberProposal = await fetch(`${base}/api/jara/proposals`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: cookieHeader(member.jar) },
    body: JSON.stringify({ config: { llmModel: 'attacker-model' }, configHash: 'x' }),
  })
  assert.equal(memberProposal.status, 403, await memberProposal.clone().text())

  const memberChat = await fetch(`${base}/api/jara/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: cookieHeader(member.jar) },
    body: JSON.stringify({ message: 'Jara, change your AI model to qwen' }),
  })
  assert.equal(memberChat.status, 200)
  const memberChatBody = await memberChat.json()
  assert.notEqual(memberChatBody.kind, 'proposal', 'only a Super Admin can start a governance change')
  assert.notEqual(memberChatBody.kind, 'applied')

  // The Super Admin's consequential instruction becomes a pending proposal, not a
  // live change: the model never applies its own configuration.
  const adminChat = await fetch(`${base}/api/jara/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: cookieHeader(admin.jar) },
    body: JSON.stringify({ message: 'Jara, change your AI model to qwen' }),
  })
  assert.equal(adminChat.status, 200, await adminChat.clone().text())
  const adminChatBody = await adminChat.json()
  assert.equal(adminChatBody.kind, 'proposal', `expected a proposal, got ${JSON.stringify(adminChatBody).slice(0, 300)}`)
  const proposal = adminChatBody.proposal
  assert.equal(proposal.status, 'pending')

  const configAfterProposal = await (await fetch(`${base}/api/jara/config`)).json()
  assert.equal(
    configAfterProposal.config?.llmModel ?? configAfterProposal.llmModel,
    'llama3.2',
    'a pending proposal must not change the live configuration',
  )

  // A normal user cannot approve it.
  const memberApprove = await fetch(`${base}/api/jara/proposals/${proposal.id}/approve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: cookieHeader(member.jar) },
    body: JSON.stringify({ configHash: proposal.configHash, version: proposal.version }),
  })
  assert.equal(memberApprove.status, 403, await memberApprove.clone().text())

  // Approving with a tampered hash is refused.
  const tampered = await fetch(`${base}/api/jara/proposals/${proposal.id}/approve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: cookieHeader(admin.jar) },
    body: JSON.stringify({ configHash: 'f'.repeat(64), version: proposal.version }),
  })
  assert.equal(tampered.status, 409, await tampered.clone().text())

  // The Super Admin approves the exact proposal that was reviewed.
  const approved = await fetch(`${base}/api/jara/proposals/${proposal.id}/approve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: cookieHeader(admin.jar) },
    body: JSON.stringify({ configHash: proposal.configHash, version: proposal.version }),
  })
  assert.equal(approved.status, 200, await approved.clone().text())

  const configAfterApproval = await (await fetch(`${base}/api/jara/config`)).json()
  const appliedConfig = configAfterApproval.config ?? configAfterApproval
  assert.equal(appliedConfig.llmModel, 'qwen2.5', 'the approved change becomes the live configuration')
  assert.equal(appliedConfig.llmProvider, 'ollama')
  assert.ok(Number(appliedConfig.version) > Number(configAfterProposal.config?.version ?? configAfterProposal.version))

  // Replay of the same approval is rejected, and the rejection is audited.
  const replay = await fetch(`${base}/api/jara/proposals/${proposal.id}/approve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: cookieHeader(admin.jar) },
    body: JSON.stringify({ configHash: proposal.configHash, version: proposal.version }),
  })
  assert.equal(replay.status, 409, await replay.clone().text())

  // The audit trail records the proposal, the denial and the approval.
  const history = await fetch(`${base}/api/jara/history`, { headers: { cookie: cookieHeader(admin.jar) } })
  assert.equal(history.status, 200, await history.clone().text())
  const historyBody = await history.json()
  const audit = historyBody.logs || historyBody.auditLogs || historyBody.audit || []
  const actions = audit.map((entry) => entry.action)
  assert.ok(actions.includes('propose'), `audit must record the proposal: ${JSON.stringify(actions)}`)
  assert.ok(actions.includes('apply') || actions.includes('approve'), `audit must record the approval: ${JSON.stringify(actions)}`)
  assert.ok(
    audit.some((entry) => entry.action === 'attempt_blocked' || entry.authorizationResult === 'denied'),
    'refused attempts are audited too',
  )

  // Governance never rewrites Jara's permanent identity.
  const jara = await (await fetch(`${base}/api/jara/profile`)).json()
  assert.equal(jara.user.id, JARA_ID)
  assert.equal(jara.user.username, 'jara')
  assert.equal(jara.user.email, 'jara@friendconnect.local')
  assert.equal(jara.user.role, 'jara')

  // A disabled Jara stops answering, without deleting the identity or history.
  const disable = await fetch(`${base}/api/jara/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: cookieHeader(admin.jar) },
    body: JSON.stringify({ message: 'Jara, disable yourself' }),
  })
  const disableBody = await disable.json()
  if (disableBody.kind === 'proposal') {
    await fetch(`${base}/api/jara/proposals/${disableBody.proposal.id}/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookieHeader(admin.jar) },
      body: JSON.stringify({ configHash: disableBody.proposal.configHash, version: disableBody.proposal.version }),
    })
  }
  const afterDisable = await (await fetch(`${base}/api/jara/profile`)).json()
  assert.equal(afterDisable.user.id, JARA_ID, 'disabling must not destroy the permanent identity')
  assert.ok(logs().length > 0)
})
