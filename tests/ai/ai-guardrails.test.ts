import test from 'node:test'
import assert from 'node:assert/strict'
import { aiChat, AIProviderError, AIInputRejectedError } from '../../src/lib/ai'

const providerEnvKeys = [
  'OLLAMA_URL', 'OLLAMA_MODEL', 'LITELLM_URL', 'LITELLM_API_KEY', 'LITELLM_MODEL',
  'ZAI_API_KEY', 'OPENROUTER_API_KEY', 'OPENROUTER_MODEL',
  'HUGGINGFACE_API_KEY', 'HF_MODEL', 'OPENAI_API_KEY', 'AI_API_KEY', 'OPENAI_BASE_URL', 'AI_MODEL',
]

async function withCleanProviderEnv<T>(run: () => Promise<T>): Promise<T> {
  const saved = new Map(providerEnvKeys.map((key) => [key, process.env[key]]))
  for (const key of providerEnvKeys) delete process.env[key]
  try { return await run() }
  finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

test('a prompt containing a credential is rejected before any provider call', async () => {
  await withCleanProviderEnv(async () => {
    process.env.OLLAMA_URL = 'http://configured-provider.invalid'
    const originalFetch = globalThis.fetch
    let calls = 0
    globalThis.fetch = (async () => { calls += 1; return new Response('{}', { status: 200 }) }) as typeof fetch
    try {
      await assert.rejects(
        aiChat([{ role: 'user', content: 'use this key: sk-abcdefghijklmnopqrstuvwxyz123456' }]),
        (error: unknown) => error instanceof AIInputRejectedError && error.code === 'AI_INPUT_REJECTED',
      )
      assert.equal(calls, 0, 'no provider may be contacted with a secret in the prompt')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

test('a normal prompt still reaches the configured provider', async () => {
  await withCleanProviderEnv(async () => {
    process.env.OLLAMA_URL = 'http://configured-provider.invalid'
    const originalFetch = globalThis.fetch
    let calls = 0
    globalThis.fetch = (async () => {
      calls += 1
      return new Response(JSON.stringify({ message: { content: 'pong' } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }) as typeof fetch
    try {
      const out = await aiChat([{ role: 'user', content: 'ping' }])
      assert.equal(out, 'pong')
      assert.equal(calls, 1)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

test('litellm adapter is selected when LITELLM_URL is set', async () => {
  await withCleanProviderEnv(async () => {
    process.env.LITELLM_URL = 'http://litellm-proxy.invalid:4000'
    process.env.LITELLM_MODEL = 'my-model'
    const originalFetch = globalThis.fetch
    let url = ''
    globalThis.fetch = (async (input: any) => {
      url = String(input)
      return new Response(JSON.stringify({ choices: [{ message: { content: 'litellm-ok' } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }) as typeof fetch
    try {
      const out = await aiChat([{ role: 'user', content: 'hello' }])
      assert.equal(out, 'litellm-ok')
      assert.equal(url, 'http://litellm-proxy.invalid:4000/chat/completions')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
