'use strict'

/**
 * Poll API tests (finding #7).
 *
 * The audit found the poll endpoints were the least protected write paths in the
 * app: any signed-in user could vote in any poll, `optionIdx` was only checked
 * for being a number, the vote was a read-then-write race against a unique
 * constraint, `expiresAt` was stored but never enforced, and the create route
 * accepted arbitrary option arrays. These tests run the real standalone build
 * against a throwaway SQLite database and assert the fixed contract.
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
      const { port } = server.address()
      server.close(() => resolvePort(port))
    })
  })
}

function collectCookies(response, jar) {
  for (const cookie of response.headers.getSetCookie?.() ?? []) {
    const [pair] = cookie.split(';')
    const index = pair.indexOf('=')
    if (index > 0) jar.set(pair.slice(0, index), pair.slice(index + 1))
  }
}

function cookieHeader(jar) {
  return Array.from(jar, ([name, value]) => `${name}=${value}`).join('; ')
}

async function waitHealthy(base, child, logs) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`app exited early\n${logs()}`)
    try {
      if ((await fetch(`${base}/api/health`)).ok) return
    } catch {
      /* still starting */
    }
    await new Promise((r) => setTimeout(r, 150))
  }
  throw new Error(`app did not become healthy\n${logs()}`)
}

/** Register a user and log in through NextAuth (the path the UI uses). */
async function registerAndLogin(base, name) {
  const jar = new Map()
  const suffix = `${name}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`.toLowerCase()
  const credentials = { name, username: suffix, email: `${suffix}@polls.invalid`, password: 'ValidPassw0rd!' }
  const register = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(credentials),
  })
  assert.equal(register.status, 201, await register.text())

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
  const me = await fetch(`${base}/api/me`, { headers: { cookie: cookieHeader(jar) } })
  assert.equal(me.status, 200, 'login must establish a session')
  const { user } = await me.json()
  return { jar, credentials, id: user.id }
}

test(
  'poll creation validates input, voting is participant-only, atomic, idempotent and expiry-aware',
  { timeout: 120_000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'friendconnect-polls-'))
    const appPort = await freePort()
    const base = `http://127.0.0.1:${appPort}`
    const env = {
      ...process.env,
      NODE_ENV: 'production',
      DATABASE_URL: `file:${join(root, 'polls.sqlite')}`,
      NEXTAUTH_SECRET: 'polls-integration-not-a-production-secret',
      NEXTAUTH_URL: base,
      APP_ORIGIN: base,
      UPLOAD_DIR: join(root, 'uploads'),
      PORT: String(appPort),
      HOSTNAME: '127.0.0.1',
      REDIS_URL: '',
    }
    let logs = ''
    const app = spawn(process.execPath, [join(repo, '.next/standalone/server.js')], {
      cwd: join(repo, '.next/standalone'),
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    app.stdout.on('data', (d) => {
      logs += d.toString()
    })
    app.stderr.on('data', (d) => {
      logs += d.toString()
    })
    t.after(async () => {
      app.kill('SIGTERM')
      await new Promise((r) => (app.exitCode !== null ? r() : app.once('exit', r)))
      await rm(root, { recursive: true, force: true })
    })

    await waitHealthy(base, app, () => logs)

    const alice = await registerAndLogin(base, 'PollAlice')
    const bob = await registerAndLogin(base, 'PollBob')
    const carol = await registerAndLogin(base, 'PollCarol')

    const asUser = (user, path, init = {}) =>
      fetch(`${base}${path}`, {
        ...init,
        headers: { 'content-type': 'application/json', cookie: cookieHeader(user.jar), ...(init.headers || {}) },
      })

    // A conversation that includes Carol (the outsider of the later poll).
    const conversationResponse = await asUser(alice, '/api/conversations', {
      method: 'POST',
      body: JSON.stringify({ type: 'group', title: 'Poll room', memberIds: [bob.id, carol.id] }),
    })
    const conversationText = await conversationResponse.text()
    assert.equal(conversationResponse.status, 201, `conversation create failed: ${conversationResponse.status} body=${conversationText}\n${logs.slice(-4000)}`)
    const conversationId = JSON.parse(conversationText).conversation.id

    // --- input validation -------------------------------------------------
    const blankOption = await asUser(alice, '/api/polls/create', {
      method: 'POST',
      body: JSON.stringify({ conversationId, question: 'Lunch?', options: ['Yes', '  '] }),
    })
    assert.equal(blankOption.status, 400, 'blank options are rejected')
    assert.doesNotMatch(await blankOption.text(), /at .*\.ts:\d+/, 'error text never echoes internal paths')

    const nonArrayOptions = await asUser(alice, '/api/polls/create', {
      method: 'POST',
      body: JSON.stringify({ conversationId, question: 'Lunch?', options: 'Yes,No' }),
    })
    assert.equal(nonArrayOptions.status, 400)

    const duplicateOptions = await asUser(alice, '/api/polls/create', {
      method: 'POST',
      body: JSON.stringify({ conversationId, question: 'Lunch?', options: ['Yes', 'Yes'] }),
    })
    assert.equal(duplicateOptions.status, 400, 'duplicate options are rejected')

    const tooManyOptions = await asUser(alice, '/api/polls/create', {
      method: 'POST',
      body: JSON.stringify({ conversationId, question: 'Lunch?', options: Array.from({ length: 50 }, (_, i) => `opt ${i}`) }),
    })
    assert.equal(tooManyOptions.status, 400, 'option count is bounded')

    const pastExpiry = await asUser(alice, '/api/polls/create', {
      method: 'POST',
      body: JSON.stringify({ conversationId, question: 'Lunch?', options: ['Yes', 'No'], expiresAt: '2000-01-01T00:00:00.000Z' }),
    })
    assert.equal(pastExpiry.status, 400, 'expiry must be in the future')

    const outsiderCreate = await asUser(carol, '/api/polls/create', {
      method: 'POST',
      body: JSON.stringify({ conversationId, question: 'Injected', options: ['a', 'b'] }),
    })
    // Carol *is* a member here, so this must succeed; the authorization case is
    // covered below by a user outside the conversation entirely.
    assert.equal(outsiderCreate.status, 201, `${await outsiderCreate.clone().text()}\n${logs.slice(-2500)}`)

    // --- creation --------------------------------------------------------
    const createResponse = await asUser(alice, '/api/polls/create', {
      method: 'POST',
      body: JSON.stringify({ conversationId, question: 'Where do we eat?', options: [' Cafe ', 'Canteen'] }),
    })
    const createText = await createResponse.text()
    assert.equal(createResponse.status, 201, createText)
    const created = JSON.parse(createText)
    assert.equal(created.poll.question, 'Where do we eat?')
    assert.deepEqual(created.poll.options, ['Cafe', 'Canteen'], 'options are trimmed')
    assert.equal(created.poll.expiresAt, null)
    const pollId = created.poll.id
    assert.ok(pollId)
    // The message that carries the poll exists (the two were written atomically).
    assert.ok(created.message.id)
    const history = await asUser(alice, `/api/conversations/${conversationId}/messages`)
    assert.equal(history.status, 200)
    const historyBody = await history.json()
    assert.ok(
      historyBody.messages.some((message) => message.id === created.message.id),
      'the poll message is part of the conversation history',
    )

    // --- voting ----------------------------------------------------------
    const vote = await asUser(bob, `/api/polls/${pollId}/vote`, {
      method: 'POST',
      body: JSON.stringify({ optionIdx: 1 }),
    })
    const voteText = await vote.text()
    assert.equal(vote.status, 200, voteText)
    const voteBody = JSON.parse(voteText)
    assert.deepEqual(voteBody.tally, [
      { optionIdx: 0, count: 0 },
      { optionIdx: 1, count: 1 },
    ])
    assert.equal(voteBody.totalVotes, 1)
    assert.equal(voteBody.myVote, 1)

    // Changing your mind updates the same vote instead of failing on the unique key.
    const changedVote = await asUser(bob, `/api/polls/${pollId}/vote`, {
      method: 'POST',
      body: JSON.stringify({ optionIdx: 0 }),
    })
    assert.equal(changedVote.status, 200)
    const changedBody = await changedVote.json()
    assert.deepEqual(changedBody.tally, [
      { optionIdx: 0, count: 1 },
      { optionIdx: 1, count: 0 },
    ])

    // Concurrent identical votes must not 500 on the unique constraint.
    const concurrent = await Promise.all(
      [0, 1, 0, 1, 0].map(() =>
        asUser(alice, `/api/polls/${pollId}/vote`, { method: 'POST', body: JSON.stringify({ optionIdx: 1 }) }),
      ),
    )
    for (const response of concurrent) {
      assert.equal(response.status, 200, await response.text())
    }
    const afterConcurrent = await (await asUser(alice, `/api/polls/${pollId}/vote`)).json()
    // Bob has one vote (option 0) and Alice's five concurrent submissions must
    // collapse into exactly one vote (option 1) instead of five rows or a 500.
    assert.deepEqual(
      afterConcurrent.tally.map((entry) => entry.count),
      [1, 1],
      'one vote per user survives concurrent submissions',
    )

    // --- validation of the vote itself ------------------------------------
    for (const bad of [-1, 1.5, 99, '1']) {
      const response = await asUser(alice, `/api/polls/${pollId}/vote`, {
        method: 'POST',
        body: JSON.stringify({ optionIdx: bad }),
      })
      assert.equal(response.status, 400, `optionIdx ${JSON.stringify(bad)} must be rejected`)
    }

    // A user outside the conversation cannot vote or read results.
    const dave = await registerAndLogin(base, 'PollDave')
    const outsiderVote = await asUser(dave, `/api/polls/${pollId}/vote`, {
      method: 'POST',
      body: JSON.stringify({ optionIdx: 0 }),
    })
    assert.equal(outsiderVote.status, 403, 'a non-participant cannot vote in someone else\'s poll')
    const outsiderRead = await asUser(dave, `/api/polls/${pollId}/vote`)
    assert.equal(outsiderRead.status, 403, 'a non-participant cannot read the tally either')

    // --- expiry -----------------------------------------------------------
    const expiringResponse = await asUser(alice, '/api/polls/create', {
      method: 'POST',
      body: JSON.stringify({
        conversationId,
        question: 'Closing soon?',
        options: ['Yes', 'No'],
        expiresAt: new Date(Date.now() + 1500).toISOString(),
      }),
    })
    const expiringText = await expiringResponse.text()
    assert.equal(expiringResponse.status, 201, expiringText)
    const expiringPollId = JSON.parse(expiringText).poll.id
    await asUser(bob, `/api/polls/${expiringPollId}/vote`, {
      method: 'POST',
      body: JSON.stringify({ optionIdx: 0 }),
    })
    await new Promise((r) => setTimeout(r, 1800))
    const lateVote = await asUser(bob, `/api/polls/${expiringPollId}/vote`, {
      method: 'POST',
      body: JSON.stringify({ optionIdx: 1 }),
    })
    const lateBody = await lateVote.text()
    assert.equal(lateVote.status, 200, lateBody)
    const lateJson = JSON.parse(lateBody)
    assert.equal(lateJson.expired, true, 'the poll reports that it is closed')
    assert.equal(lateJson.myVote, null)
    assert.deepEqual(
      lateJson.tally.map((entry) => entry.count),
      [1, 0],
      'a closed poll keeps its existing tally and ignores new votes',
    )
  },
)
