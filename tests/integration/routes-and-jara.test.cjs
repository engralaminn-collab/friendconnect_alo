'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdtemp, rm } = require('fs/promises')
const { tmpdir } = require('os')
const { join, resolve } = require('path')
const { spawn } = require('child_process')
const { createHmac } = require('crypto')
const net = require('net')
const { io } = require('socket.io-client')
const sharp = require('sharp')

const repo = resolve(__dirname, '../..')

function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      server.close((err) => err ? reject(err) : resolvePort(port))
    })
  })
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

function cookieHeader(jar) {
  return Array.from(jar, ([name, value]) => `${name}=${value}`).join('; ')
}

async function waitHealthy(url, child, output) {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Next server exited early (${child.exitCode})\n${output()}`)
    try {
      const response = await fetch(`${url}/api/health`)
      if (response.status < 500) return
    } catch {}
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100))
  }
  throw new Error(`Next server health timeout\n${output()}`)
}

async function registerAndLogin(base, name) {
  const jar = new Map()
  const suffix = `${name}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`
  const credentials = { name, username: suffix.toLowerCase(), email: `${suffix.toLowerCase()}@security.invalid`, password: 'ValidPassw0rd!' }
  const register = await fetch(`${base}/api/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(credentials),
  })
  const regText = await register.text()
  assert.equal(register.status, 201, regText)
  const regJson = JSON.parse(regText)

  const csrfResponse = await fetch(`${base}/api/auth/csrf`)
  assert.equal(csrfResponse.ok, true)
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
  assert.ok([200, 302].includes(login.status), `NextAuth credentials callback status ${login.status}`)
  return { jar, credentials, user: regJson.user }
}

function signHttpSmsJwt(secret) {
  const b64u = (v) => Buffer.from(v).toString('base64url')
  const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = b64u(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 120 }))
  const sig = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${sig}`
}

test('conversation messages, attachment ownership, preferences, star/edit/delete socket emit, Jara health & SMS security', { timeout: 60_000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'friendconnect-routes-jara-'))
  const dbFile = join(root, 'isolated.sqlite')
  const uploadPath = join(root, 'private-uploads')
  const appPort = await freePort()
  const socketPort = await freePort()
  const base = `http://127.0.0.1:${appPort}`

  const childEnv = { ...process.env }
  for (const key of ['JARA_ASR_URL', 'JARA_TTS_URL', 'JARA_GPU_WORKER_URL', 'COMFYUI_API_URL', 'RUNNINGHUB_API_KEY', 'JARA_SMS_PROVIDER', 'HTTPSMS_API_KEY', 'TELNYX_API_KEY', 'TWILIO_ACCOUNT_SID']) delete childEnv[key]
  const env = {
    ...childEnv,
    NODE_ENV: 'production',
    DATABASE_URL: `file:${dbFile}`,
    NEXTAUTH_SECRET: 'integration-routes-secret-001',
    NEXTAUTH_URL: base,
    APP_ORIGIN: base,
    APP_DIR: repo,
    UPLOAD_DIR: uploadPath,
    PORT: String(appPort),
    HOSTNAME: '127.0.0.1',
    SOCKET_PORT: String(socketPort),
    SOCKET_INTERNAL_URL: `http://127.0.0.1:${socketPort}`,
    HTTPSMS_WEBHOOK_SIGNING_KEY: 'httpsms-integration-secret',
    REDIS_URL: '',
  }

  const app = spawn(process.execPath, [join(repo, '.next/standalone/server.js')], { cwd: join(repo, '.next/standalone'), env, stdio: ['ignore', 'pipe', 'pipe'] })
  let appLogs = ''
  app.stdout.on('data', (d) => { appLogs += d.toString() })
  app.stderr.on('data', (d) => { appLogs += d.toString() })

  const socketServer = spawn(process.execPath, ['socket-server.js'], { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let socketLogs = ''
  socketServer.stdout.on('data', (d) => { socketLogs += d.toString() })
  socketServer.stderr.on('data', (d) => { socketLogs += d.toString() })

  const sockets = []
  t.after(async () => {
    for (const s of sockets) s.close()
    socketServer.kill('SIGTERM')
    app.kill('SIGTERM')
    await Promise.all([
      new Promise((r) => app.once('exit', r)),
      new Promise((r) => socketServer.once('exit', r)),
    ])
    await rm(root, { recursive: true, force: true })
  })

  await waitHealthy(base, app, () => appLogs)
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    try { if ((await fetch(`http://127.0.0.1:${socketPort}/health`)).ok) break } catch {}
    await new Promise((r) => setTimeout(r, 100))
  }
  assert.ok(Date.now() < deadline, `socket server timeout\n${socketLogs}`)

  const alice = await registerAndLogin(base, 'Alice')
  const bob = await registerAndLogin(base, 'Bob')

  // Befriend Alice and Bob so DM conversation creation succeeds cleanly.
  const frRes = await fetch(`${base}/api/friends`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: cookieHeader(alice.jar) },
    body: JSON.stringify({ action: 'request', targetId: bob.user.id }),
  })
  assert.equal(frRes.status, 200, await frRes.clone().text())
  const acceptRes = await fetch(`${base}/api/friends/request/${alice.user.id}/accept`, {
    method: 'POST',
    headers: { cookie: cookieHeader(bob.jar) },
  })
  assert.equal(acceptRes.status, 200, await acceptRes.clone().text())

  // Open a direct conversation between Alice and Bob.
  const convRes = await fetch(`${base}/api/conversations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: cookieHeader(alice.jar) },
    body: JSON.stringify({ type: 'direct', memberIds: [bob.user.id] }),
  })
  assert.ok([200, 201].includes(convRes.status), await convRes.clone().text())
  const conv = (await convRes.json()).conversation

  // Connect Bob's Socket.IO client to verify REST -> Socket.IO realtime fanout.
  const bobTok = await (await fetch(`${base}/api/auth/token`, { headers: { cookie: cookieHeader(bob.jar) } })).json()
  const bobSocket = io(`http://127.0.0.1:${socketPort}`, { auth: { token: bobTok.token }, transports: ['websocket'], reconnection: false })
  sockets.push(bobSocket)
  await new Promise((res, rej) => {
    bobSocket.once('auth:ok', res)
    bobSocket.once('connect_error', rej)
  })

  // Alice uploads a PNG attachment.
  const pngBytes = await sharp({ create: { width: 12, height: 12, channels: 3, background: { r: 20, g: 160, b: 120 } } }).png().toBuffer()
  const form = new FormData()
  form.append('file', new File([pngBytes], 'photo.png', { type: 'image/png' }))
  form.append('visibility', 'private')
  const uploadRes = await fetch(`${base}/api/files/upload`, {
    method: 'POST',
    headers: { cookie: cookieHeader(alice.jar) },
    body: form,
  })
  assert.equal(uploadRes.status, 200, await uploadRes.clone().text())
  const uploadJson = await uploadRes.json()
  const uploaded = uploadJson.file
  const attachmentId = uploadJson.attachment?.id
  assert.ok(attachmentId, 'upload must persist Attachment record')

  // Bob CANNOT spoof Alice's file as his avatar or attach Alice's attachmentId.
  const spoofAvatar = await fetch(`${base}/api/me`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie: cookieHeader(bob.jar) },
    body: JSON.stringify({ avatarUrl: uploaded.url }),
  })
  assert.equal(spoofAvatar.status, 403)

  const spoofAttach = await fetch(`${base}/api/conversations/${conv.id}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: cookieHeader(bob.jar) },
    body: JSON.stringify({ content: 'steal', attachmentIds: [attachmentId] }),
  })
  assert.equal(spoofAttach.status, 403)

  // Alice sends message with her attachment -> Bob receives socket `message:new` AND download grant!
  const msgPromise = new Promise((resolveMsg) => bobSocket.once('message:new', resolveMsg))
  const sendRes = await fetch(`${base}/api/conversations/${conv.id}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: cookieHeader(alice.jar) },
    body: JSON.stringify({ content: 'See attached', type: 'image', attachmentIds: [attachmentId] }),
  })
  assert.equal(sendRes.status, 201, await sendRes.clone().text())
  const sentMsg = (await sendRes.json()).message
  const pushedMsg = await msgPromise
  assert.equal(pushedMsg.id, sentMsg.id)
  assert.equal(pushedMsg.content, 'See attached')

  const bobDownload = await fetch(`${base}${uploaded.url}`, { headers: { cookie: cookieHeader(bob.jar) } })
  assert.equal(bobDownload.status, 200)

  // Preferences (pin & mute) persist per member.
  const prefRes = await fetch(`${base}/api/conversations/${conv.id}/preferences`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie: cookieHeader(bob.jar) },
    body: JSON.stringify({ pinned: true, muted: true }),
  })
  assert.equal(prefRes.status, 200)
  const prefJson = await prefRes.json()
  assert.equal(prefJson.preference.pinned, true)
  assert.equal(prefJson.preference.muted, true)

  // Star, verify in GET /api/messages/starred, react, edit, and delete -> starred list hides deleted message!
  assert.equal((await fetch(`${base}/api/messages/${sentMsg.id}/star`, { method: 'POST', headers: { cookie: cookieHeader(bob.jar) } })).status, 200)
  const starred1 = await (await fetch(`${base}/api/messages/starred`, { headers: { cookie: cookieHeader(bob.jar) } })).json()
  assert.equal(starred1.starred.some((m) => m.id === sentMsg.id), true)

  const reactPromise = new Promise((r) => bobSocket.once('message:reaction', r))
  const reactRes = await fetch(`${base}/api/messages/${sentMsg.id}/reactions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: cookieHeader(alice.jar) },
    body: JSON.stringify({ emoji: '🔥' }),
  })
  assert.equal(reactRes.status, 200)
  assert.equal((await reactPromise).emoji, '🔥')

  const editPromise = new Promise((r) => bobSocket.once('message:updated', r))
  const editRes = await fetch(`${base}/api/messages/${sentMsg.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie: cookieHeader(alice.jar) },
    body: JSON.stringify({ content: 'Edited text' }),
  })
  assert.equal(editRes.status, 200)
  assert.equal((await editPromise).content, 'Edited text')

  const delPromise = new Promise((r) => bobSocket.once('message:deleted', r))
  const delRes = await fetch(`${base}/api/messages/${sentMsg.id}?scope=everyone`, {
    method: 'DELETE',
    headers: { cookie: cookieHeader(alice.jar) },
  })
  assert.equal(delRes.status, 200)
  assert.equal((await delPromise).id, sentMsg.id)

  const starred2 = await (await fetch(`${base}/api/messages/starred`, { headers: { cookie: cookieHeader(bob.jar) } })).json()
  assert.equal(starred2.starred.some((m) => m.id === sentMsg.id), false)

  // Jara health is honest in unconfigured env.
  const jaraHealth = await (await fetch(`${base}/api/jara/health`)).json()
  assert.equal(jaraHealth.voice.mode, 'browser_fallback')
  assert.equal(jaraHealth.renderer.mode, 'browser_fallback')
  assert.equal(jaraHealth.sms.provider, 'none')

  // Normal users are blocked from Super Admin SMS and Renderer controls.
  assert.equal((await fetch(`${base}/api/jara/sms`, { headers: { cookie: cookieHeader(alice.jar) } })).status, 403)
  assert.equal((await fetch(`${base}/api/jara/sms/send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: cookieHeader(alice.jar) },
    body: JSON.stringify({ to: '+15551234567', body: 'hi' }),
  })).status, 403)
  assert.equal((await fetch(`${base}/api/jara/renderer/render`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: cookieHeader(alice.jar) },
    body: JSON.stringify({ title: 'x' }),
  })).status, 403)

  // Disabled SMS webhook fails closed with 503.
  const disabledWebhook = await fetch(`${base}/api/jara/sms/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ data: { content: 'hi', contact: '+15550001111' } }),
  })
  assert.equal(disabledWebhook.status, 503)

  // Promote Alice to superadmin directly in the isolated SQLite DB to verify admin SMS & renderer fail-closed behavior.
  const { DatabaseSync } = require('node:sqlite')
  const rawDb = new DatabaseSync(dbFile)
  rawDb.prepare('UPDATE "User" SET "role" = ? WHERE "id" = ?').run('superadmin', alice.user.id)
  rawDb.close()

  // Enable httpSMS inbound webhook as Super Admin; reject unsigned (401) and accept valid HS256 JWT (200).
  const cfgRes = await fetch(`${base}/api/jara/sms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: cookieHeader(alice.jar) },
    body: JSON.stringify({
      enabled: true,
      provider: 'httpsms',
      senderId: '+15550009999',
      inboundEnabled: true,
      outboundEnabled: false,
      webhookSecret: 'httpsms-integration-secret',
    }),
  })
  assert.equal(cfgRes.status, 200, await cfgRes.clone().text())

  const badWebhook = await fetch(`${base}/api/jara/sms/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ data: { content: 'hi', contact: '+15550001111' } }),
  })
  assert.equal(badWebhook.status, 401)

  const goodJwt = signHttpSmsJwt('httpsms-integration-secret')
  const validWebhook = await fetch(`${base}/api/jara/sms/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${goodJwt}` },
    body: JSON.stringify({ type: 'message.phone.received', data: { id: 'evt-1', content: 'hi Jara', contact: '+15550001111', owner: '+15550009999' } }),
  })
  assert.equal(validWebhook.status, 200, await validWebhook.clone().text())
  const webhookJson = await validWebhook.json()
  assert.equal(webhookJson.ok, true)
  assert.equal(webhookJson.optOut, false)

  const adminRender = await fetch(`${base}/api/jara/renderer/render`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: cookieHeader(alice.jar) },
    body: JSON.stringify({ title: 'Townhall', script: 'Hello' }),
  })
  assert.equal(adminRender.status, 503)
  const adminSmsSend = await fetch(`${base}/api/jara/sms/send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: cookieHeader(alice.jar) },
    body: JSON.stringify({ to: '+15551234567', body: 'Test' }),
  })
  assert.equal(adminSmsSend.status, 503)
})
