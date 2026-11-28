'use strict'

/**
 * Static guard for the error-disclosure class of findings.
 *
 * The remediation removed several places that published an exception's own text
 * to a client. This test reads the route sources and fails if the pattern comes
 * back, so the fix is enforced rather than remembered.
 *
 * It is deliberately conservative: it looks for an exception variable being
 * interpolated or passed straight into a response, which is never necessary —
 * routes either choose a fixed message or route the error through
 * `handleRouteError` / `validationFailure`, which whitelist what may be published.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync, readdirSync, statSync } = require('node:fs')
const { join, relative, resolve } = require('node:path')

const ROOT = resolve(__dirname, '../..')
const API_DIR = join(ROOT, 'src/app/api')

function routeFiles(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...routeFiles(full))
    else if (entry === 'route.ts') out.push(full)
  }
  return out
}

/** Body of every `catch (...) { ... }` block in a source string. */
function catchBodies(source) {
  const bodies = []
  const opener = /\}\s*catch\s*(?:\(\s*(\w+)\s*(?::\s*[^)]+)?\))?\s*\{/g
  let match
  while ((match = opener.exec(source))) {
    const variable = match[1] || null
    let depth = 1
    let i = opener.lastIndex
    while (i < source.length && depth > 0) {
      if (source[i] === '{') depth += 1
      else if (source[i] === '}') depth -= 1
      i += 1
    }
    bodies.push({ variable, body: source.slice(opener.lastIndex, i - 1) })
  }
  return bodies
}

const files = routeFiles(API_DIR)
assert.ok(files.length > 100, `expected to scan the API routes, found ${files.length}`)

test('no route publishes a raw exception message in a response', () => {
  const offenders = []
  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    for (const { variable, body } of catchBodies(source)) {
      if (!variable) continue
      // A catch that hands the error to the shared handler is exactly what we want.
      if (body.includes('handleRouteError(')) continue
      // Naming the exception in a server-side log or audit record is fine, as is
      // handing it to a typed helper that decides what may be published (the
      // message of a deliberately-thrown domain error is part of that type's
      // contract, unlike a message that happens to be on some caught object).
      const publishable = body
        .split('\n')
        .filter((line) => !/console\.(log|warn|error)|writeJaraAudit|logger\.|auditLog|jaraAuditLog/.test(line))
        // `detail:` is an audit-record field, never a response body.
        .filter((line) => !/^\s*detail:/.test(line))
        .filter((line) => !/validationFailure\(|featureGateFailure\(|handleRouteError\(/.test(line))
        .filter((line) => !/(instanceof\s+\w*Error)\s*\).*errorJson\(\s*e/.test(line))
        .join('\n')
      const patterns = [
        // `errorJson(e.message === 'UNAUTHORIZED' ? 'A' : 'B', ...)` compares the
        // message and publishes a fixed string, which is safe; the negative
        // lookahead keeps that idiomatic guard out of the results.
        new RegExp(`errorJson\\(\\s*${variable}\\??\\.message(?!\\s*[=!]==)`),
        new RegExp(`\\$\\{\\s*${variable}\\??\\.message`),
        new RegExp(`errorJson\\([^)]*${variable}\\??\\.message\\s*\\|\\|`),
        // `String(e)` on its own is ambiguous (it may be building a log detail),
        // so only treat it as a leak when it feeds a response.
        new RegExp(`errorJson\\([^)]*String\\(\\s*${variable}\\b`),
      ]
      const hit = patterns.find((p) => p.test(publishable))
      if (hit) {
        offenders.push(`${relative(ROOT, file)}: /${hit.source}/`)
      }
    }
  }
  assert.deepEqual(offenders, [], `routes still echo exception text:\n${offenders.join('\n')}`)
})

test('the shared error handler is where unknown failures go', () => {
  const handler = readFileSync(join(ROOT, 'src/lib/api-errors.ts'), 'utf8')
  // A deliberately-published message must still be checked for leak patterns.
  assert.match(handler, /isLeakyMessage\(/)
  assert.match(handler, /DEFAULT_MESSAGE/)
})

test('the validation helper only publishes messages the route constructed', () => {
  const guards = readFileSync(join(ROOT, 'src/lib/jara-route-guards.ts'), 'utf8')
  // 4xx-only: a 500 built by the route is not a client-safe message.
  assert.match(guards, /status >= 400 && status < 500/)
})
