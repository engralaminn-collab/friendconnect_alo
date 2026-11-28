'use strict'

/**
 * Behavioral tests for the AI identity and permission model.
 *
 * These encode the rules the remediation prompt makes non-negotiable: AI accounts
 * are always disclosed, permissions are scoped and default-deny, an AI never
 * exceeds the human it acts for, a block beats a grant, and sensitive actions need
 * per-action approval.
 *
 * The module is TypeScript, so the test drives it through `tsx` (the same runner
 * `test:security` already uses for the `.test.ts` files).
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { join, resolve } = require('node:path')

const ROOT = resolve(__dirname, '../..')

/**
 * Run a small script against the TypeScript module and return its JSON output.
 *
 * Doing it this way keeps the test suite in the CJS style the rest of
 * `tests/security` uses while still testing the real compiled-from-source module.
 */
function runTs(script) {
  const out = execFileSync(
    join(ROOT, 'node_modules/.bin/tsx'),
    ['--eval', `import * as mod from '${join(ROOT, 'src/lib/ai-identity.ts')}'; ${script}`],
    { cwd: ROOT, encoding: 'utf8' },
  )
  return JSON.parse(out.trim().split('\n').pop())
}

test('an AI identity is always disclosed as AI', () => {
  const result = runTs(`
    const id = mod.defaultIdentity({ id: 'ai-1', displayName: 'Jara', mode: 'personal' });
    const pub = mod.publicAIIdentity(id);
    console.log(JSON.stringify({ pub }));
  `)
  assert.equal(result.pub.isAI, true)
  assert.equal(result.pub.badge, 'AI Assistant')
  // The disclosure names the assistant and states it is not human.
  assert.match(result.pub.disclosure, /AI assistant, not a human/)
  assert.match(result.pub.disclosure, /Jara/)
})

test('default scopes are restrictive and exclude external actions', () => {
  const result = runTs(`
    const modes = ['personal','organization','group','support','meeting','document','research','workflow'];
    const out = {};
    for (const m of modes) {
      out[m] = mod.defaultIdentity({ id: 'x', displayName: 'X', mode: m }).scopes;
    }
    console.log(JSON.stringify({ out, external: mod.APPROVAL_REQUIRED_SCOPES }));
  `)
  for (const [mode, scopes] of Object.entries(result.out)) {
    // No mode may default to sending SMS, email, or execution workflows.
    assert.ok(!scopes.includes('send-sms'), `${mode} must not default to send-sms`)
    assert.ok(!scopes.includes('send-email'), `${mode} must not default to send-email`)
    // The workflow assistant is the one mode whose purpose *is* running
    // workflows; it still requires per-action approval (checked below), so its
    // default grant is allowed to include the scope.
    if (mode !== 'workflow') {
      assert.ok(!scopes.includes('execute-workflows'), `${mode} must not default to execute-workflows`)
    }
    assert.ok(!scopes.includes('access-external-apis'), `${mode} must not default to access-external-apis`)
  }
  // A meeting assistant gets call scopes but not messaging.
  assert.ok(result.out.meeting.includes('join-audio-calls'))
  assert.ok(!result.out.meeting.includes('send-messages'))
})

test('an unknown scope is denied, never ignored', () => {
  const result = runTs(`
    const id = mod.defaultIdentity({ id: 'ai-1', displayName: 'Jara', mode: 'personal' });
    const d = mod.authorize('destroy-everything', { identity: id, actingForUserId: 'u1' });
    console.log(JSON.stringify(d));
  `)
  assert.equal(result.allowed, false)
  assert.equal(result.reason, 'unknown-scope')
})

test('a scope the identity does not hold is denied', () => {
  const result = runTs(`
    const id = mod.defaultIdentity({ id: 'ai-1', displayName: 'Jara', mode: 'document' });
    const d = mod.authorize('send-sms', { identity: id, actingForUserId: 'u1', approved: true });
    console.log(JSON.stringify(d));
  `)
  assert.equal(result.allowed, false)
  assert.equal(result.reason, 'scope-not-granted')
})

test('a suspended identity is denied everything, immediately', () => {
  const result = runTs(`
    const base = mod.defaultIdentity({ id: 'ai-1', displayName: 'Jara', mode: 'personal' });
    const suspended = { ...base, status: 'suspended' };
    const out = {};
    for (const scope of ['read-messages','send-messages','read-documents']) {
      out[scope] = mod.authorize(scope, { identity: suspended, actingForUserId: 'u1' });
    }
    out.effective = mod.effectiveScopes({ identity: suspended, actingForUserId: 'u1' });
    console.log(JSON.stringify(out));
  `)
  for (const scope of ['read-messages', 'send-messages', 'read-documents']) {
    assert.equal(result[scope].allowed, false)
    assert.equal(result[scope].reason, 'identity-suspended')
  }
  assert.deepEqual(result.effective, [], 'suspension must clear effective scopes')
})

test('the AI may not exceed the permissions of the human it acts for', () => {
  const result = runTs(`
    const id = { ...mod.defaultIdentity({ id: 'ai-1', displayName: 'Jara', mode: 'personal' }),
                 scopes: ['read-messages','send-messages'] };
    const out = {};
    // The human can read but not send.
    out.humanLimited = mod.authorize('send-messages', {
      identity: id, actingForUserId: 'u1', humanScopes: ['read-messages'],
    });
    out.humanAllowed = mod.authorize('read-messages', {
      identity: id, actingForUserId: 'u1', humanScopes: ['read-messages','send-messages'],
    });
    console.log(JSON.stringify(out));
  `)
  assert.equal(result.humanLimited.allowed, false)
  assert.equal(result.humanLimited.reason, 'exceeds-human-permission')
  assert.equal(result.humanAllowed.allowed, true)
})

test('a block beats a grant and beats an approval', () => {
  const result = runTs(`
    const id = { ...mod.defaultIdentity({ id: 'ai-1', displayName: 'Jara', mode: 'personal' }),
                 scopes: ['read-messages','send-messages','send-sms'] };
    const out = {};
    out.read = mod.authorize('read-messages', { identity: id, actingForUserId: 'u1', subjectUserId: 'u2', blocked: true });
    // Even with an explicit approval, a block still wins.
    out.sms = mod.authorize('send-sms', { identity: id, actingForUserId: 'u1', subjectUserId: 'u2', blocked: true, approved: true });
    console.log(JSON.stringify(out));
  `)
  assert.equal(result.read.allowed, false)
  assert.equal(result.read.reason, 'blocked')
  assert.equal(result.sms.allowed, false)
  assert.equal(result.sms.reason, 'blocked', 'an approval must never override a block')
})

test('external actions require per-action approval', () => {
  const result = runTs(`
    const id = { ...mod.defaultIdentity({ id: 'ai-1', displayName: 'Jara', mode: 'personal' }),
                 scopes: ['send-sms','send-email','execute-workflows'] };
    const out = {};
    for (const scope of ['send-sms','send-email','execute-workflows']) {
      out[scope + '_no'] = mod.authorize(scope, { identity: id, actingForUserId: 'u1' });
      out[scope + '_yes'] = mod.authorize(scope, { identity: id, actingForUserId: 'u1', approved: true });
    }
    console.log(JSON.stringify(out));
  `)
  for (const scope of ['send-sms', 'send-email', 'execute-workflows']) {
    assert.equal(result[`${scope}_no`].allowed, false)
    assert.equal(result[`${scope}_no`].reason, 'approval-required')
    assert.equal(result[`${scope}_yes`].allowed, true)
  }
})

test('call participation requires an actual invitation', () => {
  const result = runTs(`
    const id = { ...mod.defaultIdentity({ id: 'ai-1', displayName: 'Jara', mode: 'meeting' }) };
    const out = {};
    out.noInvite = mod.authorize('join-audio-calls', { identity: id, actingForUserId: 'u1' });
    out.invited = mod.authorize('join-audio-calls', { identity: id, actingForUserId: 'u1', invitedToContext: true });
    out.transcribeNoConsent = mod.authorize('transcribe-meetings', { identity: id, actingForUserId: 'u1', invitedToContext: true, approved: false });
    out.transcribeApproved = mod.authorize('transcribe-meetings', { identity: id, actingForUserId: 'u1', invitedToContext: true, approved: true });
    console.log(JSON.stringify(out));
  `)
  assert.equal(result.noInvite.allowed, false)
  assert.equal(result.noInvite.reason, 'not-invited')
  assert.equal(result.invited.allowed, true)
  // Transcription is approval-gated too: joining is not consenting to recording.
  assert.equal(result.transcribeNoConsent.allowed, false)
  assert.equal(result.transcribeNoConsent.reason, 'approval-required')
  assert.equal(result.transcribeApproved.allowed, true, 'with explicit consent, transcription is allowed')
})

test('a user grant narrows what the identity may do for that user', () => {
  const result = runTs(`
    const id = { ...mod.defaultIdentity({ id: 'ai-1', displayName: 'Jara', mode: 'personal' }),
                 scopes: ['read-messages','send-messages'] };
    const out = {};
    out.narrowed = mod.authorize('send-messages', {
      identity: id, actingForUserId: 'u1', userGrantedScopes: ['read-messages'],
    });
    out.effective = mod.effectiveScopes({
      identity: id, actingForUserId: 'u1', userGrantedScopes: ['read-messages'],
    });
    console.log(JSON.stringify(out));
  `)
  assert.equal(result.narrowed.allowed, false)
  assert.equal(result.narrowed.reason, 'scope-not-granted-by-user')
  assert.deepEqual(result.effective, ['read-messages'])
})
