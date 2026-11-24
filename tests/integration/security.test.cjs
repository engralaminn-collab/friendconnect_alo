'use strict'

/**
 * Security regression tests for findings #3, #4, #5, #6 and #10.
 *
 * These run against a real server on an isolated database. Each assertion
 * corresponds to an attack that worked before the remediation.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdtemp, rm } = require('fs/promises')
const { tmpdir } = require('os')
const { join, resolve } = require('path')
const { spawn } = require('child_process')
const net = require('net')
const { createHmac } = require('crypto')

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

// --- TOTP, implemented independently of src/lib/totp.ts ---------------------
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
function base32Decode(input) {
  let bits = 0
  let value = 0
  const bytes = []
  for (const char of input.replace(/=+$/, '').toUpperCase()) {
    const idx = BASE32.indexOf(char)
    if (idx < 0) continue
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(bytes)
}

function totp(secret, stepOffset = 0) {
  const counter = Math.floor(Date.now() / 30000) + stepOffset
  const buffer = Buffer.alloc(8)
  buffer.writeUInt32BE(Math.floor(counter / 0x100000000), 0)
  buffer.writeUInt32BE(counter % 0x100000000, 4)
  const hmac = createHmac('sha1', base32Decode(secret)).update(buffer).digest()
  const offset = hmac[hmac.length - 1] & 0xf
  const code =
    ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3]
  return String(code % 1000000).padStart(6, '0')
}

async function register(base, name) {
  const jar = new Map()
  const suffix = `${name}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`.toLowerCase()
  const credentials = {
    name,
    username: suffix,
    email: `${suffix}@security.invalid`,
    password: 'ValidPassw0rd!',
  }
  const response = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(credentials),
  })
  const text = await response.text()
  assert.equal(response.status, 201, `register failed: ${text}`)
  const body = JSON.parse(text)
  return { jar, credentials, id: body?.user?.id }
}

async function login(base, jar, credentials, extra = {}) {
  const csrfResponse = await fetch(`${base}/api/auth/csrf`)
  collectCookies(csrfResponse, jar)
  const { csrfToken } = await csrfResponse.json()
  const form = new URLSearchParams({
    csrfToken,
    identifier: credentials.username,
    password: credentials.password,
    callbackUrl: `${base}/`,
    json: 'true',
    ...extra,
  })
  const response = await fetch(`${base}/api/auth/callback/credentials`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookieHeader(jar) },
    body: form,
  })
  collectCookies(response, jar)
  return { status: response.status, location: response.headers.get('location') || '' }
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

test('security: block enforcement, reactions, reset flow, 2FA and file access', { timeout: 180_000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'friendconnect-security-'))
  const dbFile = join(root, 'security.sqlite')
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
    // Wrong-but-plausible URL: the cache must degrade, not fail (finding #11).
    // Redis is intentionally left unset here; that is covered by
    // tests/security/redis-failure.test.cjs.
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

  const alice = await register(base, 'Alice')
  const bob = await register(base, 'Bob')
  const carol = await register(base, 'Carol')

  for (const account of [alice, bob, carol]) {
    const result = await login(base, account.jar, account.credentials)
    assert.ok([200, 302].includes(result.status), `login failed: ${result.status} ${result.location}`)
  }

  const a = client(base, alice.jar)
  const b = client(base, bob.jar)
  const c = client(base, carol.jar)

  const aliceId = (await a('/api/me')).body?.user?.id
  const bobId = (await b('/api/me')).body?.user?.id
  const carolId = (await c('/api/me')).body?.user?.id

  // ===== finding #3: a blocked user cannot message or read the thread =====
  await a('/api/friends', { method: 'POST', body: JSON.stringify({ action: 'request', targetId: bobId }) })
  await b(`/api/friends/request/${aliceId}/accept`, { method: 'POST' })

  const seed = await a('/api/messages', {
    method: 'POST',
    body: JSON.stringify({ receiverId: bobId, content: 'before the block' }),
  })
  assert.equal(seed.status, 200, JSON.stringify(seed.body))
  const seedMessageId = seed.body?.message?.id

  // Bob blocks Alice.
  await b('/api/friends', { method: 'POST', body: JSON.stringify({ action: 'block', targetId: aliceId }) })

  const afterBlock = await a('/api/messages', {
    method: 'POST',
    body: JSON.stringify({ receiverId: bobId, content: 'after the block' }),
  })
  assert.equal(afterBlock.status, 403, `blocked sender must be refused, got ${afterBlock.status}`)

  const readThread = await a(`/api/messages?userId=${bobId}`)
  assert.equal(readThread.status, 403, 'a blocked user must not read the thread')

  // ===== finding #4: non-participants cannot react to a message =====
  const carolReaction = await c(`/api/messages/${seedMessageId}/reactions`, {
    method: 'POST',
    body: JSON.stringify({ emoji: '\u{1F44D}' }),
  })
  assert.equal(carolReaction.status, 404, 'a stranger reacting must look like "not found"')

  const bobReaction = await b(`/api/messages/${seedMessageId}/reactions`, {
    method: 'POST',
    body: JSON.stringify({ emoji: '\u{1F44D}' }),
  })
  assert.equal(bobReaction.status, 200, 'a participant may react')

  // Emoji input is validated.
  const badEmoji = await b(`/api/messages/${seedMessageId}/reactions`, {
    method: 'POST',
    body: JSON.stringify({ emoji: '<script>alert(1)</script>' }),
  })
  assert.equal(badEmoji.status, 400)

  // ===== finding #10: attachments are owner-scoped and access is granted =====
  // A minimal, well-formed PDF: the upload allow-list deliberately accepts only
  // a fixed set of non-browser-active types, so plain text is not a valid upload.
  const pdfBytes = Buffer.from(
    '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
      '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
  )
  const form = new FormData()
  form.append('file', new Blob([pdfBytes], { type: 'application/pdf' }), 'note.pdf')
  const upload = await fetch(`${base}/api/files/upload`, {
    method: 'POST',
    body: form,
    headers: { cookie: cookieHeader(alice.jar) },
  })
  assert.equal(upload.status, 200, `upload failed: ${await upload.clone().text()}`)
  const uploaded = await upload.json()
  const fileUrl = uploaded.file.url

  // The owner can download.
  const ownerDownload = await fetch(`${base}${fileUrl}`, { headers: { cookie: cookieHeader(alice.jar) } })
  assert.equal(ownerDownload.status, 200)

  // So can a participant of a message carrying it...
  // Blocking severed the friendship (by design), so re-establish it: Bob is the
  // one who blocked, and only he can undo it.
  await b('/api/friends', { method: 'POST', body: JSON.stringify({ action: 'unblock', targetId: aliceId }) })
  await a('/api/friends', { method: 'POST', body: JSON.stringify({ action: 'request', targetId: bobId }) })
  const reAccepted = await b(`/api/friends/request/${aliceId}/accept`, { method: 'POST' })
  assert.equal(reAccepted.status, 200, JSON.stringify(reAccepted.body))
  assert.equal((await a('/api/friends')).body.friends.length, 1, 're-friending must succeed after an unblock')
  const withAttachment = await a('/api/messages', {
    method: 'POST',
    body: JSON.stringify({
      receiverId: bobId,
      content: '',
      fileUrl,
      fileName: 'note.pdf',
      fileSize: pdfBytes.length,
      mimeType: 'application/pdf',
    }),
  })
  assert.equal(withAttachment.status, 200, JSON.stringify(withAttachment.body))
  const bobDownload = await fetch(`${base}${fileUrl}`, { headers: { cookie: cookieHeader(bob.jar) } })
  assert.equal(bobDownload.status, 200, 'the recipient of an attachment may download it')

  // ...but a third party cannot.
  const carolDownload = await fetch(`${base}${fileUrl}`, { headers: { cookie: cookieHeader(carol.jar) } })
  assert.equal(carolDownload.status, 403, 'an unrelated user must not download a private attachment')

  // Sending someone else's file is refused.
  const stolenAttachment = await c('/api/messages', {
    method: 'POST',
    body: JSON.stringify({ receiverId: bobId, content: '', fileUrl, fileName: 'note.pdf' }),
  })
  assert.equal(stolenAttachment.status, 403, 'attaching a file you do not own must be refused')

  // ===== finding #5: the reset flow leaks nothing and is attempt-limited ====
  const forgot = await fetch(`${base}/api/auth/forgot`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: carol.credentials.email }),
  })
  assert.equal(forgot.status, 200)
  const forgotBody = await forgot.json()
  assert.equal(forgotBody.otp, undefined, 'the code must never be in the response')
  assert.equal(forgotBody.resetToken, undefined)

  const forgotUnknown = await fetch(`${base}/api/auth/forgot`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'nobody@security.invalid' }),
  })
  assert.equal(forgotUnknown.status, 200)
  assert.equal(
    (await forgotUnknown.json()).message,
    forgotBody.message,
    'unknown accounts must produce an identical response',
  )

  // Read the code from the server log: it is the only place it appears.
  const codeMatch = [...logs.matchAll(/reset code for [^\s:]+: (\d{6})/g)].pop()
  assert.ok(codeMatch, 'expected the development reset code to be logged')

  const verify = await fetch(`${base}/api/auth/verify-otp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: carol.credentials.email, otp: codeMatch[1] }),
  })
  assert.equal(verify.status, 200, `verify failed: ${await verify.clone().text()}`)
  const verified = await verify.json()
  assert.ok(verified.resetToken, 'a reset token must be issued')
  assert.ok(!verified.resetToken.includes(codeMatch[1]), 'the token must not contain the code')
  assert.ok(!verified.resetToken.includes(carolId), 'the token must not contain the user id')

  // A wrong code is refused and counted.
  const wrongCode = await fetch(`${base}/api/auth/verify-otp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: carol.credentials.email, otp: '000000' }),
  })
  assert.equal(wrongCode.status, 400)

  // The token works exactly once.
  const reset = await fetch(`${base}/api/auth/reset-password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: carol.credentials.email,
      password: 'BrandNewPassw0rd!',
      resetToken: verified.resetToken,
    }),
  })
  assert.equal(reset.status, 200, `reset failed: ${await reset.clone().text()}`)

  const replay = await fetch(`${base}/api/auth/reset-password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: carol.credentials.email,
      password: 'AnotherPassw0rd!',
      resetToken: verified.resetToken,
    }),
  })
  assert.equal(replay.status, 400, 'a reset token must be single-use')

  // The reset invalidated the old session.
  const afterReset = await c('/api/me')
  assert.equal(afterReset.status, 401, 'existing sessions must be revoked by a password reset')

  // ===== finding #6: 2FA enrolment, disable guards and backup codes =====
  // The reset above revoked Carol's session, which is the behaviour we just
  // asserted; sign in again with the new password to continue.
  const relogin = await login(base, carol.jar, {
    username: carol.credentials.username,
    password: 'BrandNewPassw0rd!',
  })
  assert.ok([200, 302].includes(relogin.status), `re-login failed: ${relogin.status} ${relogin.location}`)

  const setup = await c('/api/2fa/setup', { method: 'POST' })
  assert.equal(setup.status, 200, JSON.stringify(setup.body))
  assert.equal(setup.body.qrDataUrl, undefined, 'no third-party QR URL may be returned')
  assert.ok(setup.body.uri.startsWith('otpauth://'), 'a local otpauth URI is returned instead')
  const secret = setup.body.secret
  assert.ok(secret && !JSON.stringify(setup.body).includes('qrserver'), 'the secret must not leave via a URL')

  // Enabling requires a correct code.
  const badVerify = await c('/api/2fa/verify', { method: 'POST', body: JSON.stringify({ code: '000000' }) })
  assert.equal(badVerify.status, 400)

  const goodVerify = await c('/api/2fa/verify', { method: 'POST', body: JSON.stringify({ code: totp(secret) }) })
  assert.equal(goodVerify.status, 200, JSON.stringify(goodVerify.body))
  const backupCodes = goodVerify.body.backupCodes
  assert.equal(backupCodes.length, 10, 'ten backup codes are issued')

  // Logging in again now demands the second factor: the password alone must not
  // produce a session cookie.
  const noCodeJar = new Map()
  const withoutCode = await login(
    base,
    noCodeJar,
    { username: carol.credentials.username, password: 'BrandNewPassw0rd!' },
  )
  assert.equal(withoutCode.status, 401, '2FA login without a code must be rejected')
  assert.ok(
    !Array.from(noCodeJar.keys()).some((key) => key.includes('session-token')),
    'a rejected 2FA login must not set a session cookie',
  )

  // With the correct code the same login succeeds.
  const withCodeJar = new Map()
  const withCode = await login(
    base,
    withCodeJar,
    { username: carol.credentials.username, password: 'BrandNewPassw0rd!' },
    { totp: totp(secret) },
  )
  assert.ok([200, 302].includes(withCode.status), `2FA login with a code failed: ${withCode.status}`)
  assert.ok(
    Array.from(withCodeJar.keys()).some((key) => key.includes('session-token')),
    'a correct second factor must produce a session',
  )

  // Disabling needs the password AND a code: password alone must fail.
  const disablePasswordOnly = await c('/api/2fa/disable', {
    method: 'POST',
    body: JSON.stringify({ password: 'BrandNewPassw0rd!' }),
  })
  assert.equal(disablePasswordOnly.status, 400, 'a code is required to disable 2FA')

  const disableWrongCode = await c('/api/2fa/disable', {
    method: 'POST',
    body: JSON.stringify({ password: 'BrandNewPassw0rd!', code: '000000' }),
  })
  assert.ok([400, 403].includes(disableWrongCode.status))

  const disableBadPassword = await c('/api/2fa/disable', {
    method: 'POST',
    body: JSON.stringify({ password: 'wrong-password', code: totp(secret) }),
  })
  assert.equal(disableBadPassword.status, 403, 'the password is verified too')

  // A backup code disables 2FA exactly once.
  const disableWithBackup = await c('/api/2fa/disable', {
    method: 'POST',
    body: JSON.stringify({ password: 'BrandNewPassw0rd!', code: backupCodes[0] }),
  })
  assert.equal(disableWithBackup.status, 200, JSON.stringify(disableWithBackup.body))
  assert.equal(disableWithBackup.body.enabled, false)

  // ===== no response leaks database or stack internals =====
  const leaked = await a('/api/messages', {
    method: 'POST',
    body: JSON.stringify({ receiverId: 'does-not-exist', content: 'x' }),
  })
  const serialised = JSON.stringify(leaked.body)
  assert.ok(!/sqlite|prisma|constraint|no such table|at .*:\d+:\d+/i.test(serialised), `leaked: ${serialised}`)
})
