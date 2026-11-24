import test from 'node:test'
import assert from 'node:assert/strict'
import { aiChat, AIProviderError } from '../../src/lib/ai'

const providerEnvKeys = [
  'OLLAMA_URL', 'OLLAMA_MODEL', 'ZAI_API_KEY', 'OPENROUTER_API_KEY', 'OPENROUTER_MODEL',
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

test('unconfigured AI throws a typed failure instead of returning fake assistant text', async () => {
  await withCleanProviderEnv(async () => {
    await assert.rejects(
      aiChat([{ role: 'user', content: 'Hello' }]),
      (error: unknown) => error instanceof AIProviderError && error.code === 'AI_PROVIDER_UNAVAILABLE',
    )
  })
})

test('provider failures do not silently send the prompt to another provider', async () => {
  await withCleanProviderEnv(async () => {
    process.env.OLLAMA_URL = 'http://configured-provider.invalid'
    process.env.ZAI_API_KEY = 'test-only-not-a-credential'
    const originalFetch = globalThis.fetch
    let calls = 0
    globalThis.fetch = (async () => {
      calls += 1
      return new Response('provider unavailable', { status: 503 })
    }) as typeof fetch
    try {
      await assert.rejects(
        aiChat([{ role: 'user', content: 'private user prompt' }]),
        (error: unknown) => error instanceof AIProviderError && error.code === 'AI_PROVIDER_UNAVAILABLE',
      )
      assert.equal(calls, 1, 'only the explicitly selected Ollama adapter is called')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
