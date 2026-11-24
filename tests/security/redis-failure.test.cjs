'use strict'

/**
 * Finding #11: a Redis outage must not become an auth outage.
 *
 * Before the fix, `rateLimit()` awaited `cache.incr()` unguarded. With
 * REDIS_URL set and the server down, ioredis rejected, the rejection propagated
 * out of the login route and the caller got a 500 — every login attempt failed
 * because rate limiting could not be evaluated. With `enableOfflineQueue`
 * enabled the command instead queued forever and the request hung.
 *
 * The required behaviour, asserted here, is:
 *   1. rate limiting still answers (no throw, no hang) while Redis is down,
 *   2. the limit is still enforced, using in-process counters,
 *   3. cached values written during the outage are still readable,
 *   4. the process can shut the client down and exit.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdtemp, rm } = require('fs/promises')
const { tmpdir } = require('os')
const { join, resolve } = require('path')
const { spawnSync } = require('child_process')

const repo = resolve(__dirname, '../..')

test('rate limiting survives an unreachable Redis without throwing or hanging', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'friendconnect-redis-'))
  t.after(() => rm(root, { recursive: true, force: true }))

  const script = join(root, 'probe.ts')
  const { writeFile } = require('fs/promises')
  await writeFile(
    script,
    `
process.env.REDIS_URL = 'redis://127.0.0.1:6399' // nothing listens here
import { rateLimit, getCache, closeCache } from ${JSON.stringify(join(repo, 'src/lib/cache'))}

;(async () => {
  const started = Date.now()
  const allowed = []
  for (let i = 0; i < 4; i += 1) allowed.push((await rateLimit('probe', 3, 60)).allowed)
  const elapsed = Date.now() - started

  await getCache().set('probe:value', { a: 1 }, 30)
  const cached = await getCache().get('probe:value')

  await closeCache()
  process.stdout.write(JSON.stringify({ allowed, elapsed, cached }) + '\\n')
})().catch((error) => {
  process.stdout.write(JSON.stringify({ threw: error.message }) + '\\n')
  process.exit(1)
})
`,
  )

  const run = spawnSync(process.execPath, [join(repo, 'node_modules/tsx/dist/cli.mjs'), script], {
    cwd: repo,
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, REDIS_URL: 'redis://127.0.0.1:6399' },
  })

  assert.equal(run.error, undefined, `probe failed to run: ${run.error}`)
  assert.equal(run.status, 0, `probe exited ${run.status}\n${run.stdout}\n${run.stderr}`)

  const line = run.stdout
    .split('\n')
    .reverse()
    .find((entry) => entry.trim().startsWith('{'))
  assert.ok(line, `no JSON result in output:\n${run.stdout}\n${run.stderr}`)

  const result = JSON.parse(line)
  assert.equal(result.threw, undefined, `rate limiting threw with Redis down: ${result.threw}`)
  assert.deepEqual(
    result.allowed,
    [true, true, true, false],
    'the limit must still be enforced using in-process counters',
  )
  assert.ok(result.elapsed < 15_000, `requests hung for ${result.elapsed}ms waiting on Redis`)
  assert.deepEqual(result.cached, { a: 1 }, 'values written during the outage must remain readable')
})
