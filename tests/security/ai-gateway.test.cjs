'use strict'

/**
 * Behavioral tests for the multi-provider AI gateway.
 *
 * The gateway's whole reason to exist is that provider selection is a *policy*
 * decision, not "whichever env var is set". These tests pin the policy:
 * local-first, no silent external transfer of private content, capability-aware
 * routing, and an explicit fallback chain that never widens permissions.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { join, resolve } = require('node:path')

const ROOT = resolve(__dirname, '../..')

/** Run a snippet against the module with a controlled environment. */
function runTs(script, env = {}) {
  const out = execFileSync(
    join(ROOT, 'node_modules/.bin/tsx'),
    ['--eval', `import * as mod from '${join(ROOT, 'src/lib/ai-gateway.ts')}'; ${script}`],
    {
      cwd: ROOT,
      encoding: 'utf8',
      // Start from a clean slate so a developer's own env cannot make the test lie.
      env: { PATH: process.env.PATH, NODE_ENV: 'test', ...env },
    },
  )
  return JSON.parse(out.trim().split('\n').pop())
}

test('a private endpoint is recognised as local, a public one is not', () => {
  const result = runTs(`
    const cases = [
      'http://localhost:11434', 'http://127.0.0.1:8080', 'http://10.0.0.5:8000',
      'http://192.168.1.4:11434', 'http://172.16.5.2:8000', 'http://ollama:11434',
      'http://api.openai.com/v1', 'https://openrouter.ai/api/v1', 'http://8.8.8.8:80',
      'not a url at all',
    ];
    const out = {};
    for (const c of cases) out[c] = mod.isPrivateEndpoint(c);
    console.log(JSON.stringify(out));
  `)
  for (const host of [
    'http://localhost:11434',
    'http://127.0.0.1:8080',
    'http://10.0.0.5:8000',
    'http://192.168.1.4:11434',
    'http://172.16.5.2:8000',
    'http://ollama:11434',
  ]) {
    assert.equal(result[host], true, `${host} must be treated as local`)
  }
  for (const host of ['http://api.openai.com/v1', 'https://openrouter.ai/api/v1', 'http://8.8.8.8:80']) {
    assert.equal(result[host], false, `${host} must be treated as external`)
  }
})

test('with only a local provider configured, routing stays local', () => {
  const result = runTs(
    `
    const d = mod.routeRequest({
      capability: 'text',
      allowedProviderIds: ['ollama', 'openrouter'],
      dataClass: 'private',
    });
    console.log(JSON.stringify({ d, primary: mod.primaryProviderId() }));
  `,
    { OLLAMA_URL: 'http://127.0.0.1:11434' },
  )
  assert.ok(result.d, 'a provider should have been selected')
  assert.equal(result.d.provider.id, 'ollama')
  assert.equal(result.d.localFirst, true)
  assert.equal(result.primary, 'ollama')
})

test('private content is never routed to an unconfigured external provider', () => {
  const result = runTs(
    `
    const d = mod.routeRequest({
      capability: 'text',
      allowedProviderIds: ['ollama', 'openrouter'],
      dataClass: 'private',
    });
    console.log(JSON.stringify({ d }));
  `,
    // Only a cloud key: nothing local exists at all.
    { OPENROUTER_API_KEY: 'test-key' },
  )
  // No local provider is available and private content may not leave, so the
  // gateway must refuse to route rather than quietly send it to OpenRouter.
  assert.equal(result.d, null, 'private content must not be sent to an external provider by default')
})

test('external providers are usable for private content only with explicit operator opt-in', () => {
  const result = runTs(
    `
    const d = mod.routeRequest({
      capability: 'text',
      allowedProviderIds: ['openrouter'],
      dataClass: 'private',
    });
    console.log(JSON.stringify({ d }));
  `,
    { OPENROUTER_API_KEY: 'test-key', AI_ALLOW_EXTERNAL_PRIVATE_CONTENT: 'true' },
  )
  assert.ok(result.d)
  assert.equal(result.d.provider.id, 'openrouter')
  assert.equal(result.d.localFirst, false)
})

test('a provider the caller did not authorise is never used', () => {
  const result = runTs(
    `
    const d = mod.routeRequest({
      capability: 'text',
      allowedProviderIds: ['litellm'],
      dataClass: 'public',
    });
    console.log(JSON.stringify({ d }));
  `,
    { OLLAMA_URL: 'http://127.0.0.1:11434', OPENROUTER_API_KEY: 'test-key' },
  )
  assert.equal(result.d, null, 'an unlisted provider must not be selected even for public content')
})

test('capability routing refuses a provider that lacks the capability', () => {
  const result = runTs(
    `
    const audio = mod.routeRequest({
      capability: 'audio-transcription',
      allowedProviderIds: ['ollama'],
      dataClass: 'private',
    });
    const text = mod.routeRequest({
      capability: 'text',
      allowedProviderIds: ['ollama'],
      dataClass: 'private',
    });
    console.log(JSON.stringify({ audio, text }));
  `,
    { OLLAMA_URL: 'http://127.0.0.1:11434' },
  )
  // No adapter here implements transcription yet, so it must not be advertised.
  assert.equal(result.audio, null, 'audio transcription must not be claimed for a text-only adapter')
  assert.ok(result.text)
})

test('no provider claims a capability it does not declare', () => {
  const result = runTs(`
    const dir = mod.modelDirectory();
    const bad = [];
    for (const p of dir) {
      for (const m of p.models) {
        for (const c of m.capabilities) {
          if (!p.capabilities.includes(c)) bad.push({ provider: p.id, model: m.model, capability: c });
        }
      }
    }
    console.log(JSON.stringify({ bad, providers: dir.map(p => ({ id: p.id, caps: p.capabilities })) }));
  `)
  assert.deepEqual(result.bad, [], 'a model must not declare a capability its provider lacks')
  // And nothing today should claim audio/video capability silently.
  for (const provider of result.providers) {
    assert.ok(
      !provider.caps.includes('speech'),
      `${provider.id} must not claim speech synthesis without an adapter`,
    )
  }
})

test('the fallback chain excludes the failed provider and never widens the allowlist', () => {
  const result = runTs(
    `
    const chain = mod.fallbackChain(
      { capability: 'text', allowedProviderIds: ['ollama', 'litellm'], dataClass: 'private' },
      'ollama',
    );
    console.log(JSON.stringify({ chain: chain.map(c => c.provider.id) }));
  `,
    { OLLAMA_URL: 'http://127.0.0.1:11434', LITELLM_URL: 'http://127.0.0.1:4000' },
  )
  assert.ok(!result.chain.includes('ollama'), 'the failed provider must not be retried in the chain')
  for (const id of result.chain) {
    assert.ok(['ollama', 'litellm'].includes(id), `${id} was not authorised but appeared in the chain`)
  }
})

test('a preferred model is honoured only when it can serve the request', () => {
  const result = runTs(
    `
    const ok = mod.routeRequest({
      capability: 'text', allowedProviderIds: ['ollama'], dataClass: 'private',
      preferredModel: 'qwen2.5',
    });
    const bad = mod.routeRequest({
      capability: 'text', allowedProviderIds: ['ollama'], dataClass: 'private',
      preferredModel: 'gpt-5-imaginary',
    });
    console.log(JSON.stringify({ ok, bad }));
  `,
    { OLLAMA_URL: 'http://127.0.0.1:11434' },
  )
  assert.equal(result.ok.model, 'qwen2.5')
  assert.equal(result.ok.localFirst, false, 'an explicit model choice is not the local-first rule')
  // An unknown model falls back to a real one rather than being passed through.
  assert.notEqual(result.bad.model, 'gpt-5-imaginary')
  assert.ok(result.bad.skipped.some((s) => /preferred model/.test(s.reason)))
})

test('the model directory exposes no credentials or endpoints', () => {
  const result = runTs(
    `
    const dir = mod.modelDirectory();
    console.log(JSON.stringify({ raw: JSON.stringify(dir) }));
  `,
    {
      OLLAMA_URL: 'http://127.0.0.1:11434',
      OPENROUTER_API_KEY: 'sk-or-super-secret-value',
      OPENAI_API_KEY: 'sk-openai-super-secret-value',
      OPENAI_BASE_URL: 'https://api.openai.com/v1',
    },
  )
  assert.ok(!result.raw.includes('super-secret'), 'the client-facing directory must not contain API keys')
  assert.ok(!result.raw.includes('11434'), 'the client-facing directory must not contain endpoints')
})
