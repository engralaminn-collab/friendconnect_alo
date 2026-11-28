/**
 * Audit finding 11: the application sets its own security headers, and a
 * hostname suffix (the former `.e2b.app` exception) does not relax framing.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { proxy } from '../../src/proxy'

async function run(url: string) {
  return await proxy(new NextRequest(url))
}

test('every response carries the application security headers', async () => {
  const res = await run('http://localhost:3000/dashboard')
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(res.headers.get('x-frame-options'), 'DENY')
  assert.equal(res.headers.get('referrer-policy'), 'strict-origin-when-cross-origin')
  assert.match(res.headers.get('content-security-policy') || '', /frame-ancestors 'none'/)
  assert.match(res.headers.get('permissions-policy') || '', /camera=\(self\)/)
})

test('a preview-style host ending in .e2b.app is not trusted for framing', async () => {
  const res = await run('https://3000-abc123.e2b.app/dashboard')
  assert.equal(res.headers.get('x-frame-options'), 'DENY')
  assert.match(res.headers.get('content-security-policy') || '', /frame-ancestors 'none'/)
})

test('API responses are not stored by shared caches', async () => {
  assert.equal((await run('http://localhost:3000/api/me')).headers.get('cache-control'), 'no-store')
})
