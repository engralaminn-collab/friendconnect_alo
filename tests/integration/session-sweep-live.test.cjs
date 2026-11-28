'use strict'

/**
 * Audit finding 26, wiring: the real socket-server.js removes expired sessions on
 * its job tick, against the same database the app uses.
 *
 * `session-sweep.test.cjs` proves the sweep function works. This test proves the
 * server calls it with a working `prisma` binding. That binding is wrapped in a
 * try/catch in runJobs(), so a broken reference would fail silently without this.
 * The first job tick runs 30 seconds after start, so the test waits for it.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdtemp, rm } = require('fs/promises')
const { tmpdir } = require('os')
const { join, resolve } = require('path')
const net = require('net')
const { spawn } = require('child_process')

const repo = resolve(__dirname, '../..')

function freePort() {
  return new Promise((resolvePort, reject) => {
    const srv = net.createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => resolvePort(port))
    })
  })
}

test('the running socket server removes expired sessions on its job tick and keeps live ones', { timeout: 120_000 }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'friendconnect-session-live-'))
  const dbFile = join(dir, 'live.sqlite')
  process.env.DATABASE_URL = `file:${dbFile}`
  for (const key of Object.keys(require.cache)) {
    if (key.includes(`${repo}/src/lib/db-runtime.js`) || key.includes(`${repo}/src/lib/db-migrations.cjs`)) delete require.cache[key]
  }
  const { prisma } = require(join(repo, 'src/lib/db-runtime.js'))

  const user = await prisma.user.create({ data: { email: 'live@sweep.test', username: 'livesweep', name: 'L', passwordHash: 'h' } })
  const past = new Date(Date.now() - 60_000)
  const future = new Date(Date.now() + 86_400_000)
  const expired = await prisma.session.create({ data: { userId: user.id, sessionToken: `exp-${Date.now()}`, expiresAt: past } })
  const live = await prisma.session.create({ data: { userId: user.id, sessionToken: `live-${Date.now()}`, expiresAt: future } })

  const port = await freePort()
  const env = {
    ...process.env,
    DATABASE_URL: `file:${dbFile}`,
    NODE_ENV: 'test',
    NEXTAUTH_SECRET: 'sweep-test-only-not-a-production-secret',
    SOCKET_PORT: String(port),
    SOCKET_HOST: '127.0.0.1',
  }
  let logs = ''
  const server = spawn(process.execPath, ['socket-server.js'], { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'] })
  server.stdout.on('data', (d) => (logs += d.toString()))
  server.stderr.on('data', (d) => (logs += d.toString()))
  t.after(async () => {
    server.kill('SIGTERM')
    await new Promise((r) => setTimeout(r, 300))
    try { await prisma.$disconnect?.() } catch {}
    await rm(dir, { recursive: true, force: true })
  })

  const deadline = Date.now() + 40_000
  let removed = false
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1000))
    if (!(await prisma.session.findUnique({ where: { id: expired.id } }))) { removed = true; break }
  }
  assert.ok(removed, `expired session was not removed by the job tick\n${logs}`)
  assert.ok(await prisma.session.findUnique({ where: { id: live.id } }), 'a live session must survive the sweep')
  assert.doesNotMatch(logs, /\[jobs\] expired sessions/, 'the sweep must not log a failure')
})
