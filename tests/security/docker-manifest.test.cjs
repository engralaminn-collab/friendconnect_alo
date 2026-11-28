#!/usr/bin/env node
/**
 * Regression test for `scripts/check-docker-manifest.mjs`.
 *
 * The checker exists because two image bugs (a COPY of a module that is not a
 * dependency, and a missing COPY of modules the realtime server requires) shipped
 * past a green build. A checker that cannot fail is worthless, so this test
 * reconstructs the pre-fix Dockerfile in a temp directory and asserts that the
 * checker rejects it, then asserts it accepts the real one.
 *
 * Exit codes: 0 = checker behaves correctly, 1 = it does not.
 */
const { spawnSync } = require('node:child_process')
const { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')

const ROOT = resolve(process.cwd())
const checker = join(ROOT, 'scripts/check-docker-manifest.mjs')

function run(cwd) {
  const r = spawnSync(process.execPath, [join(cwd, 'scripts/check-docker-manifest.mjs')], {
    cwd,
    encoding: 'utf8',
  })
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` }
}

let failures = 0
function check(name, condition, detail) {
  if (condition) {
    console.log(`  ok  ${name}`)
  } else {
    failures += 1
    console.error(`  FAIL ${name}${detail ? `\n        ${detail}` : ''}`)
  }
}

// --- 1. the real repository passes -------------------------------------------
{
  const r = run(ROOT)
  check('real Dockerfiles pass the manifest check', r.code === 0, r.out.trim())
}

// --- 2. the pre-fix tree fails, naming the missing modules --------------------
{
  const tmp = mkdtempSync(join(tmpdir(), 'fc-docker-manifest-'))
  try {
    // Copy only what the checker reads: the entrypoints, their local requires,
    // package.json, and the Dockerfiles.
    for (const p of ['scripts', 'src/lib', 'socket-server.js', 'package.json', 'Dockerfile', 'deploy']) {
      cpSync(join(ROOT, p), join(tmp, p), { recursive: true })
    }
    mkdirSync(join(tmp, 'deploy'), { recursive: true })

    // Reconstruct the original Dockerfile: it copies `db-runtime.js` only, copies
    // `node-turn` (a module that is not a dependency), and copies none of the
    // `src/lib/*.cjs` modules the realtime server requires.
    const original = `FROM node:22-bookworm-slim AS runner
WORKDIR /app
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/socket-server.js ./socket-server.js
COPY --from=builder /app/scripts/turn-server.js ./scripts/turn-server.js
COPY --from=builder /app/src/lib/db-runtime.js ./src/lib/db-runtime.js
COPY --from=builder /app/node_modules/node-turn ./node_modules/node-turn
`
    writeFileSync(join(tmp, 'Dockerfile'), original)
    writeFileSync(join(tmp, 'deploy/Dockerfile.app'), original)

    const r = run(tmp)
    check('pre-fix Dockerfile is rejected', r.code === 1, r.out.trim())
    check(
      'rejection names socket-security.cjs',
      r.out.includes('src/lib/socket-security.cjs'),
      r.out.trim(),
    )
    check(
      'rejection names schema-metadata.cjs',
      r.out.includes('src/lib/schema-metadata.cjs'),
      r.out.trim(),
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}


// --- 3. a broad COPY in the builder must not mask a broken runner ------------
{
  const tmp = mkdtempSync(join(tmpdir(), 'fc-docker-stages-'))
  try {
    for (const p of ['scripts', 'src/lib', 'socket-server.js', 'package.json', 'Dockerfile', 'deploy']) {
      cpSync(join(ROOT, p), join(tmp, p), { recursive: true })
    }
    mkdirSync(join(tmp, 'deploy'), { recursive: true })

    // This is the parser defect that briefly made the new dependency check a
    // no-op: the checker saw this builder-stage COPY and incorrectly credited it
    // to the runner, even though Docker stages are isolated.
    const stagedButMissingAtRuntime = `FROM node:22 AS deps
WORKDIR /app
FROM node:22 AS builder
COPY --from=deps /app/node_modules ./node_modules
FROM node:22-slim AS runner
WORKDIR /app
COPY --from=builder /app/socket-server.js ./socket-server.js
COPY --from=builder /app/scripts/turn-server.js ./scripts/turn-server.js
COPY --from=builder /app/scripts/load-env.cjs ./scripts/load-env.cjs
COPY --from=builder /app/src/lib/db-runtime.js ./src/lib/db-runtime.js
COPY --from=builder /app/src/lib/schema-metadata.cjs ./src/lib/schema-metadata.cjs
COPY --from=builder /app/src/lib/sqlite-ddl.cjs ./src/lib/sqlite-ddl.cjs
COPY --from=builder /app/src/lib/db-migrations.cjs ./src/lib/db-migrations.cjs
COPY --from=builder /app/src/lib/socket-security.cjs ./src/lib/socket-security.cjs
COPY --from=builder /app/src/lib/file-access.cjs ./src/lib/file-access.cjs
`
    writeFileSync(join(tmp, 'Dockerfile'), stagedButMissingAtRuntime)
    writeFileSync(join(tmp, 'deploy/Dockerfile.app'), stagedButMissingAtRuntime)

    const r = run(tmp)
    check('builder-only node_modules COPY does not satisfy the runner', r.code === 1, r.out.trim())
    check('rejection names a missing runtime package', /socket.io|better-sqlite3|ioredis/.test(r.out), r.out.trim())
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

// --- 4. the fix is what makes it pass ---------------------------------------
{
  const dockerfile = readFileSync(join(ROOT, 'Dockerfile'), 'utf8')
  check(
    'Dockerfile no longer copies the undeclared node-turn module',
    !/COPY[^\n]*node_modules\/node-turn/.test(dockerfile),
  )
  check(
    'Dockerfile copies the complete production dependency tree into the runner',
    /COPY --from=prod-deps \/app\/node_modules \.\/node_modules/.test(dockerfile),
  )
  for (const mod of [
    'socket-security.cjs',
    'file-access.cjs',
    'schema-metadata.cjs',
    'sqlite-ddl.cjs',
    'db-migrations.cjs',
  ]) {
    check(`Dockerfile copies src/lib/${mod}`, dockerfile.includes(`src/lib/${mod}`))
  }
}

if (failures) {
  console.error(`\n${failures} check(s) failed.`)
  process.exit(1)
}
console.log('\nAll docker-manifest checks passed.')
