'use strict'

/**
 * Audit finding 2: the TURN relay in the root compose file.
 *
 * Source-level regression. Docker is not available in this sandbox, so this does
 * not run `docker compose config`. It checks the properties that were regressed:
 *   - the coturn image is pinned to a tag and an immutable digest (not `latest`);
 *   - the relay secret and external IP are mandatory (`:?`), with no default;
 *   - the app service no longer falls back to a built-in TURN password.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('fs')
const { join, resolve } = require('path')

const repo = resolve(__dirname, '../..')
const compose = readFileSync(join(repo, 'docker-compose.yml'), 'utf8')

function serviceBlock(name) {
  const lines = compose.split('\n')
  const start = lines.findIndex((l) => l === `  ${name}:`)
  assert.ok(start >= 0, `service ${name} must exist`)
  const out = []
  for (let i = start + 1; i < lines.length; i++) {
    if (/^ {2}\S[^:]*:\s*$/.test(lines[i])) break
    out.push(lines[i])
  }
  return out.join('\n')
}

test('the coturn image is pinned to a tag and a sha256 digest, never latest', () => {
  const turn = serviceBlock('turn')
  const image = turn.match(/^\s+image:\s*(\S+)\s*$/m)
  assert.ok(image, 'turn service must declare an image')
  assert.match(image[1], /^coturn\/coturn:[0-9][0-9.]*-[a-z0-9.]+@sha256:[0-9a-f]{64}$/, `unexpected image reference: ${image[1]}`)
  assert.doesNotMatch(image[1], /:latest/)
})

test('the TURN secret and external IP are required, with no default value', () => {
  const turn = serviceBlock('turn')
  assert.match(turn, /\$\{TURN_EXTERNAL_IP:\?/, 'TURN_EXTERNAL_IP must be required')
  assert.match(turn, /\$\{TURN_PASSWORD:\?/, 'TURN_PASSWORD must be required')
  assert.doesNotMatch(turn, /\$\{TURN_PASSWORD:-/, 'TURN_PASSWORD must not have a default')
  assert.doesNotMatch(turn, /\$\{TURN_EXTERNAL_IP:-/, 'TURN_EXTERNAL_IP must not have a default')
})

test('the app service does not fall back to a built-in TURN password', () => {
  assert.doesNotMatch(compose, /TURN_PASSWORD:\s*\$\{TURN_PASSWORD:-/)
  const app = serviceBlock('app')
  assert.match(app, /TURN_PASSWORD:\s*\$\{TURN_PASSWORD:\?/, 'app must require TURN_PASSWORD explicitly')
})

test('the turn service runs the coturn binary, not the app image', () => {
  const turn = serviceBlock('turn')
  assert.doesNotMatch(turn, /build:/, 'turn must not build the app image')
  assert.doesNotMatch(turn, /turn-server\.js/, 'the app-side stub must not be the relay')
})
