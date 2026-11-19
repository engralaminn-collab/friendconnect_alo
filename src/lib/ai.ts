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
// 6. No provider configured → returns a helpful message

type ChatMessage = { role: string; content: string }

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
    body: JSON.stringify({ inputs: prompt, parameters: { max_new_tokens: 500, temperature: 0.7 } }),
  })
  if (!res.ok) throw new Error(`HuggingFace HTTP ${res.status}`)
  const data = await res.json()
  if (Array.isArray(data) && data[0]?.generated_text) {
    return data[0].generated_text.split("assistant:").pop()?.trim() || ""
  }
  return data.generated_text || ""
}

// ---------- OpenAI-compatible (fallback) ----------

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
    body: JSON.stringify({ model, messages: fullMessages, max_tokens: 1000 }),
  })
  if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}`)
  const data = await res.json()
  return data.choices?.[0]?.message?.content || ""
}

// ---------- Main chat function — tries providers in priority order ----------

export async function aiChat(messages: ChatMessage[], systemPrompt?: string): Promise<string> {
  const provider = getAIProvider()

  try {
    switch (provider) {
      case "ollama":
        return await ollamaChat(messages, systemPrompt)
      case "zai":
        return await zaiChat(messages, systemPrompt)
      case "openrouter":
        return await openRouterChat(messages, systemPrompt)
      case "huggingface":
        return await huggingfaceChat(messages, systemPrompt)
      case "openai-compatible":
        return await openaiCompatibleChat(messages, systemPrompt)
      default:
        return "[AI not configured — set one of: OLLAMA_URL, ZAI_API_KEY, OPENROUTER_API_KEY, HUGGINGFACE_API_KEY, or OPENAI_API_KEY]"
    }
  } catch (e: any) {
    console.error(`[AI] ${provider} chat failed`, e?.message)
    // Try fallback to z-ai if available
    try {
      const zai = await getZAI()
      if (zai && provider !== "zai") {
        return await zaiChat(messages, systemPrompt)
      }
    } catch {}
    return `[AI error: ${e?.message}]`
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
