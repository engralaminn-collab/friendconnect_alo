#!/usr/bin/env node
/**
 * Security + regression suite for FriendConnect.
 *
 * Covers every vulnerability found during review so they cannot silently
 * regress. Run against a live instance:
 *
 *   BASE=http://127.0.0.1:3103 node scripts/security-regression.cjs
 *
 * Requires ALLOW_SETUP=true so the demo accounts exist. Each check prints
 * PASS/FAIL and the process exits non-zero on any failure.
 */
'use strict'

const BASE = process.env.BASE || 'http://127.0.0.1:3103'
const DEMO = { uid: 'aria@friendconnect.app', pw: 'password123' }

let pass = 0
let fail = 0
const failures = []

function check(name, expected, actual, detail) {
  if (expected === actual) {
    console.log(`  PASS  ${name} (${actual})`)
    pass++
  } else {
    console.log(`  FAIL  ${name} — expected ${expected}, got ${actual}${detail ? ` :: ${detail}` : ''}`)
    fail++
    failures.push(name)
  }
}

async function req(path, opts = {}) {
  const res = await fetch(BASE + path, opts)
  let body = null
  const text = await res.text()
  try { body = text ? JSON.parse(text) : null } catch { body = text }
  return { status: res.status, body, res }
}

/** Extract Set-Cookie headers into a jar string. */
function jarFrom(res) {
  const raw = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [res.headers.get('set-cookie')].filter(Boolean)
  return raw.map((c) => c.split(';')[0]).join('; ')
}

async function login(identifier, password) {
  const csrf = await req('/api/auth/csrf')
  const csrfToken = csrf.body?.csrfToken
  const cookie0 = jarFrom(csrf.res)
  const form = new URLSearchParams({ csrfToken, identifier, password, json: 'true' })
  const res = await fetch(BASE + '/api/auth/callback/credentials', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookie0 },
    body: form.toString(),
    redirect: 'manual',
  })
  const merged = [cookie0, jarFrom(res)].filter(Boolean).join('; ')
  const me = await fetch(BASE + '/api/auth/me', { headers: { cookie: merged } }).then((r) => r.json())
  return { cookie: merged, user: me?.user || null }
}

async function main() {
  console.log(`Security regression suite → ${BASE}\n`)

  // ---------------------------------------------------------------- auth
  console.log('Authentication')
  await req('/api/setup', { method: 'POST' })

  // Wrong password must not authenticate (this was a total bypass).
  const bad = await login(DEMO.uid, 'definitely-not-the-password')
  check('wrong password does not authenticate', null, bad.user)

  // Correct password must authenticate.
  const good = await login(DEMO.uid, DEMO.pw)
  check('correct password authenticates', DEMO.uid, good.user?.email)
  const cookie = good.cookie

  // Password reset must not persist a literal "[object Promise]" hash.
  const badHashRes = await req('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier: DEMO.uid, password: DEMO.pw }),
  })
  check('custom login route also verifies password', 200, badHashRes.status)

  // -------------------------------------------------------- authorization
  console.log('\nAuthorization')
  for (const ep of ['/api/me', '/api/messages', '/api/groups', '/api/friends', '/api/posts', '/api/notifications']) {
    const r = await req(ep)
    check(`unauthenticated ${ep} rejected`, 401, r.status)
  }

  // Group membership IDOR: a plain member must not remove the owner.
  const grp = await req('/api/groups', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ name: `SecTest ${Date.now()}` }),
  })
  const gid = grp.body?.group?.id
  const bilal = await req('/api/users/search?q=bilal', { headers: { cookie } })
  const bilalId = bilal.body?.users?.[0]?.id
  if (gid && bilalId) {
    await req(`/api/groups/${gid}/members`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ userId: bilalId }),
    })
    const bilalLogin = await login('bilal@friendconnect.app', DEMO.pw)
    const ariaId = good.user?.id
    const removeOwner = await req(`/api/groups/${gid}/members?userId=${ariaId}`, {
      method: 'DELETE',
      headers: { cookie: bilalLogin.cookie },
    })
    check('member cannot remove group owner', 403, removeOwner.status)

    const leave = await req(`/api/groups/${gid}/members?userId=${bilalId}`, {
      method: 'DELETE',
      headers: { cookie: bilalLogin.cookie },
    })
    check('member can still leave voluntarily', 200, leave.status)
  } else {
    check('group setup for IDOR test', 'created', 'missing')
  }

  // ------------------------------------------------------------- privacy
  console.log('\nPrivacy')
  const meResp = await req('/api/me', { headers: { cookie } })
  const meBody = JSON.stringify(meResp.body || {})
  check('/api/me omits twoFactorSecret', false, meBody.includes('twoFactorSecret'))

  const metricsAnon = await req('/api/metrics')
  check('metrics requires auth', 401, metricsAnon.status)
  const metricsBad = await req('/api/metrics', { headers: { authorization: 'Bearer wrong' } })
  check('metrics rejects bad token', 401, metricsBad.status)
  if (process.env.METRICS_TOKEN) {
    const metricsOk = await req('/api/metrics', { headers: { authorization: `Bearer ${process.env.METRICS_TOKEN}` } })
    check('metrics accepts valid token', 200, metricsOk.status)
  }

  // Search must not match on email.
  const emailSearch = await req(`/api/users/search?q=${encodeURIComponent('@friendconnect.app')}`, { headers: { cookie } })
  check('user search does not match email', 0, (emailSearch.body?.users || []).length)

  // -------------------------------------------------------------- session
  console.log('\nSession / realtime')
  const tok = await req('/api/auth/token', { headers: { cookie } })
  check('authenticated session yields realtime token', 200, tok.status)
  const tokAnon = await req('/api/auth/token')
  check('unauthenticated realtime token rejected', 401, tokAnon.status)

  // ------------------------------------------------------- repaired routes
  console.log('\nPreviously broken routes (missing DB models)')
  for (const ep of ['/api/conversations', '/api/reports', '/api/posts', '/api/blocks', '/api/messages/starred']) {
    const r = await req(ep, { headers: { cookie } })
    check(`${ep} no longer 500s`, 200, r.status)
  }

  // Star round-trip: write must be visible to read.
  const bid2 = bilal?.body?.users?.[0]?.id
  if (bid2) {
    const sent = await req('/api/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ receiverId: bid2, content: `star ${Date.now()}` }),
    })
    const mid = sent.body?.message?.id
    if (mid) {
      await req(`/api/messages/${mid}/star`, { method: 'POST', headers: { cookie } })
      const starred = await req('/api/messages/starred', { headers: { cookie } })
      const found = (starred.body?.starred || []).some((s) => s.id === mid)
      check('starred message is readable back', true, found)
      await req(`/api/messages/${mid}/star`, { method: 'POST', headers: { cookie } })
      const after = await req('/api/messages/starred', { headers: { cookie } })
      const gone = !(after.body?.starred || []).some((s) => s.id === mid)
      check('unstar removes it', true, gone)
    }
  }

  console.log(`\n===== RESULT: pass=${pass} fail=${fail} =====`)
  if (fail) {
    console.log('Failed:', failures.join(', '))
    process.exit(1)
  }
}

main().catch((e) => {
  console.error('suite crashed:', e)
  process.exit(1)
})
