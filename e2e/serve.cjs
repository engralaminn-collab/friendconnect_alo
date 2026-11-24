#!/usr/bin/env node
'use strict'

/**
 * Boot the production build for the Playwright suite.
 *
 * `npm run build` produces a Next.js standalone server in `.next/standalone`.
 * Playwright's `webServer` runs this file, which:
 *
 *   - checks the build exists and explains how to make one if not,
 *   - starts the realtime socket server on SOCKET_PORT (the chat spec needs it),
 *   - starts the standalone app server,
 *   - forwards both outputs so a failure is visible in the Playwright log,
 *   - exits non-zero if either child dies, so Playwright reports a startup
 *     failure instead of timing out.
 *
 * Environment is supplied by playwright.config.ts: DATABASE_URL points at a
 * throwaway database, so a run never touches development data (finding #13).
 */

const { spawn } = require('child_process')
const { existsSync } = require('fs')
const { join, dirname } = require('path')

const repoRoot = join(__dirname, '..')
const standalone = join(repoRoot, '.next', 'standalone', 'server.js')

if (!existsSync(standalone)) {
  console.error(
    [
      'E2E: no production build found.',
      '',
      'Run `npm run build` first (CI does this before `npm run test:e2e`).',
      `Expected: ${standalone}`,
    ].join('\n'),
  )
  process.exit(1)
}

const children = []

function start(name, command, args, options) {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options })
  child.stdout.on('data', (data) => process.stdout.write(`[${name}] ${data}`))
  child.stderr.on('data', (data) => process.stderr.write(`[${name}] ${data}`))
  child.on('exit', (code, signal) => {
    if (signal) return
    console.error(`[${name}] exited with code ${code}`)
    // A dead app server means every remaining spec would fail with a confusing
    // timeout; fail the webServer instead.
    shutdown(code ?? 1)
  })
  children.push(child)
  return child
}

let shuttingDown = false
function shutdown(code) {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of children) child.kill('SIGTERM')
  // Give the servers a moment, then exit regardless.
  setTimeout(() => process.exit(code), 1500).unref()
}

process.on('SIGTERM', () => shutdown(0))
process.on('SIGINT', () => shutdown(0))

const socketPort = process.env.SOCKET_PORT || '3006'

// The realtime server is required by the chat spec. It reads DATABASE_URL from
// the same environment, so it shares the throwaway database.
if (existsSync(join(repoRoot, 'socket-server.js'))) {
  start('socket', process.execPath, [join(repoRoot, 'socket-server.js')], {
    cwd: repoRoot,
    env: { ...process.env, SOCKET_PORT: socketPort },
  })
}

start('web', process.execPath, ['server.js'], {
  // The standalone server expects to run from its own directory.
  cwd: dirname(standalone),
  env: process.env,
})
