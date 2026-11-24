// AI Gateway — multi-provider abstraction for chat, summarization, translation, moderation.
//
// Supports these FREE / open-source providers (in priority order):
//
// 1. Ollama (self-hosted, 100% free, open-source)
//    Set OLLAMA_URL=http://localhost:11434
//    Models: llama3.2, qwen2.5, mistral, phi3, gemma2, etc.
//    Install: curl -fsSL https://ollama.com/install.sh | sh
//    Pull model: ollama pull llama3.2
//
// 2. z-ai-web-dev-sdk (Z.ai — already in package.json)
//    Set ZAI_API_KEY (free tier available)
//
// 3. OpenRouter (free models available)
//    Set OPENROUTER_API_KEY
//    Free models: meta-llama/llama-3.2-3b-instruct:free, etc.
//
// 4. Hugging Face Inference API (free tier)
//    Set HUGGINGFACE_API_KEY
//    Models: mistralai/Mistral-7B-Instruct, etc.
//
// 5. OpenAI-compatible API (any provider)
//    Set OPENAI_API_KEY + OPENAI_BASE_URL + AI_MODEL
//
// 6. No provider configured → throws AIProviderError; API routes report an unavailable/configuration error

type ChatMessage = { role: 'user' | 'assistant'; content: string }

export class AIProviderError extends Error {
  readonly code = 'AI_PROVIDER_UNAVAILABLE'
  constructor(message: string) {
    super(message)
    this.name = 'AIProviderError'
  }
}

const PROVIDER_TIMEOUT_MS = 45_000
function providerSignal(): AbortSignal {
  return AbortSignal.timeout(PROVIDER_TIMEOUT_MS)
}

// ---------- Provider detection ----------

export function isAIConfigured(): boolean {
  return !!(
    process.env.OLLAMA_URL ||
    process.env.ZAI_API_KEY ||
    process.env.OPENROUTER_API_KEY ||
    process.env.HUGGINGFACE_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.AI_API_KEY
  )
}

export function getAIProvider(): string {
  if (process.env.OLLAMA_URL) return "ollama"
  if (process.env.ZAI_API_KEY) return "zai"
  if (process.env.OPENROUTER_API_KEY) return "openrouter"
  if (process.env.HUGGINGFACE_API_KEY) return "huggingface"
  if (process.env.OPENAI_API_KEY || process.env.AI_API_KEY) return "openai-compatible"
  return "none"
}

export function getAvailableModels(): string[] {
  const provider = getAIProvider()
  switch (provider) {
    case "ollama":
      return ["llama3.2", "qwen2.5", "mistral", "phi3", "gemma2", "deepseek-r1"]
    case "zai":
      return ["glm-4.6", "glm-4-flash"]
    case "openrouter":
      return [
        "meta-llama/llama-3.2-3b-instruct:free",
        "google/gemma-2-9b-it:free",
        "qwen/qwen-2.5-7b-instruct:free",
        "mistralai/mistral-7b-instruct:free",
      ]
    case "huggingface":
      return ["mistralai/Mistral-7B-Instruct", "meta-llama/Llama-3.2-3B-Instruct"]
    case "openai-compatible":
      return [process.env.AI_MODEL || "gpt-4o-mini"]
    default:
      return []
  }
}

// ---------- Ollama (self-hosted, free, open-source) ----------

async function ollamaChat(messages: ChatMessage[], systemPrompt?: string): Promise<string> {
  const url = process.env.OLLAMA_URL || "http://localhost:11434"
  const model = process.env.OLLAMA_MODEL || "llama3.2"
  const fullMessages = systemPrompt
    ? [{ role: "system", content: systemPrompt }, ...messages]
    : messages

  const res = await fetch(`${url}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: providerSignal(),
    body: JSON.stringify({ model, messages: fullMessages, stream: false }),
  })
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`)
  const data = await res.json()
  return data.message?.content || ""
}

// ---------- z-ai-web-dev-sdk ----------

let _zai: any = null
async function getZAI() {
  if (_zai) return _zai
  try {
    const ZAI = (await import("z-ai-web-dev-sdk")).default
    _zai = await ZAI.create()
    return _zai
  } catch {
    return null
  }
}

async function zaiChat(messages: ChatMessage[], systemPrompt?: string): Promise<string> {
  const zai = await getZAI()
  if (!zai) throw new Error("z-ai-web-dev-sdk not available")
  const fullMessages = systemPrompt
    ? [{ role: "system", content: systemPrompt }, ...messages]
    : messages
  const completion = await zai.chat.completions.create({
    messages: fullMessages as any,
    temperature: 0.7,
    max_tokens: 1000,
  })
  return completion.choices[0]?.message?.content || ""
}

// ---------- OpenRouter (free models) ----------

async function openRouterChat(messages: ChatMessage[], systemPrompt?: string): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY
  const model = process.env.OPENROUTER_MODEL || "meta-llama/llama-3.2-3b-instruct:free"
  const fullMessages = systemPrompt
    ? [{ role: "system", content: systemPrompt }, ...messages]
    : messages

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
      "X-Title": "FriendConnect",
    },
    signal: providerSignal(),
    body: JSON.stringify({ model, messages: fullMessages, max_tokens: 1000 }),
  })
  if (!res.ok) throw new Error(`OpenRouter HTTP ${res.status}`)
  const data = await res.json()
  return data.choices?.[0]?.message?.content || ""
}

// ---------- Hugging Face Inference API ----------

async function huggingfaceChat(messages: ChatMessage[], systemPrompt?: string): Promise<string> {
  const apiKey = process.env.HUGGINGFACE_API_KEY
  const model = process.env.HF_MODEL || "mistralai/Mistral-7B-Instruct"
  const prompt = (systemPrompt ? systemPrompt + "\n\n" : "") +
    messages.map(m => `${m.role}: ${m.content}`).join("\n") + "\nassistant:"

  const res = await fetch(`https://api-inference.huggingface.co/models/${model}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    signal: providerSignal(),
    body: JSON.stringify({ inputs: prompt, parameters: { max_new_tokens: 500, temperature: 0.7 } }),
  })
  if (!res.ok) throw new Error(`HuggingFace HTTP ${res.status}`)
  const data = await res.json()
  if (Array.isArray(data) && data[0]?.generated_text) {
    return data[0].generated_text.split("assistant:").pop()?.trim() || ""
  }
  return data.generated_text || ""
}

// ---------- OpenAI-compatible HTTP adapter ----------

async function openaiCompatibleChat(messages: ChatMessage[], systemPrompt?: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY || process.env.AI_API_KEY
  const baseUrl = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1"
  const model = process.env.AI_MODEL || "gpt-4o-mini"
  const fullMessages = systemPrompt
    ? [{ role: "system", content: systemPrompt }, ...messages]
    : messages

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    signal: providerSignal(),
    body: JSON.stringify({ model, messages: fullMessages, max_tokens: 1000 }),
  })
  if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}`)
  const data = await res.json()
  return data.choices?.[0]?.message?.content || ""
}

// ---------- Main chat function: use exactly the configured provider ----------

export async function aiChat(messages: ChatMessage[], systemPrompt?: string): Promise<string> {
  const provider = getAIProvider()
  if (provider === 'none') throw new AIProviderError('No AI provider is configured.')

  try {
    let result: string
    switch (provider) {
      case 'ollama':
        result = await ollamaChat(messages, systemPrompt)
        break
      case 'zai':
        result = await zaiChat(messages, systemPrompt)
        break
      case 'openrouter':
        result = await openRouterChat(messages, systemPrompt)
        break
      case 'huggingface':
        result = await huggingfaceChat(messages, systemPrompt)
        break
      case 'openai-compatible':
        result = await openaiCompatibleChat(messages, systemPrompt)
        break
      default:
        throw new AIProviderError('No compatible AI provider is configured.')
    }
    if (!result.trim()) throw new Error('empty_completion')
    return result
  } catch {
    // Do not silently transmit user content to a different cloud provider or
    // turn an infrastructure error into a successful-looking model response.
    console.warn(`[AI] ${provider} completion failed; no cross-provider fallback was attempted`)
    throw new AIProviderError('The configured AI provider did not complete the request.')
  }
}

// ---------- High-level AI functions ----------

export async function aiSummarize(messages: { sender: string; content: string }[]): Promise<string> {
  const conversationText = messages.map(m => `${m.sender}: ${m.content}`).join("\n")
  return aiChat(
    [{ role: "user", content: `Summarize this conversation in 2-3 sentences:\n\n${conversationText}` }],
    "You are a helpful assistant that summarizes chat conversations concisely."
  )
}

export async function aiTranslate(text: string, targetLang: string): Promise<string> {
  return aiChat(
    [{ role: "user", content: `Translate to ${targetLang}: "${text}"` }],
    "You are a translator. Return only the translated text, no explanation."
  )
}

export async function aiModerate(text: string): Promise<{ flagged: boolean; reason?: string }> {
  const result = await aiChat(
    [{ role: "user", content: `Analyze this message for spam, abuse, harassment, or inappropriate content. Reply JSON: {"flagged": true/false, "reason": "short reason or null"}\n\nMessage: "${text}"` }],
    "You are a content moderation AI. Respond only with valid JSON."
  )
  try {
    const parsed = JSON.parse(result.trim().replace(/^```json?\n?/, "").replace(/```$/, ""))
    return { flagged: !!parsed.flagged, reason: parsed.reason || undefined }
  } catch {
    return { flagged: false }
  }
}

// ---------- AI provider status (for /api/ai/status) ----------

export function getAIStatus() {
  return {
    configured: isAIConfigured(),
    provider: getAIProvider(),
    models: getAvailableModels(),
    providers: {
      ollama: {
        available: !!process.env.OLLAMA_URL,
        url: process.env.OLLAMA_URL || null,
        model: process.env.OLLAMA_MODEL || "llama3.2",
        free: true,
        openSource: true,
        selfHosted: true,
      },
      zai: {
        available: !!process.env.ZAI_API_KEY,
        free: true,
        openSource: false,
      },
      openrouter: {
        available: !!process.env.OPENROUTER_API_KEY,
        free: true,
        freeModels: [
          "meta-llama/llama-3.2-3b-instruct:free",
          "google/gemma-2-9b-it:free",
          "qwen/qwen-2.5-7b-instruct:free",
        ],
      },
      huggingface: {
        available: !!process.env.HUGGINGFACE_API_KEY,
        free: true,
        freeTier: "1000 requests/day",
      },
      openai: {
        available: !!process.env.OPENAI_API_KEY || !!process.env.AI_API_KEY,
        free: false,
      },
    },
  }
}
