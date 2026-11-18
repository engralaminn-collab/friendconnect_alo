// AI Gateway — provider abstraction for chat, summarization, translation, moderation.
// Uses z-ai-web-dev-sdk (already in package.json) as primary provider.
// Falls back to OpenAI-compatible API if OPENAI_API_KEY is set.
// Falls back to a no-op if no provider is configured.

let _zai: any = null
async function getZAI() {
  if (_zai) return _zai
  try {
    const ZAI = (await import("z-ai-web-dev-sdk")).default
    _zai = await ZAI.create()
    return _zai
  } catch (e) {
    return null
  }
}

export function isAIConfigured(): boolean {
  return !!process.env.ZAI_API_KEY || !!process.env.OPENAI_API_KEY || !!process.env.AI_API_KEY
}

export async function aiChat(messages: { role: string; content: string }[], systemPrompt?: string): Promise<string> {
  // Try z-ai-web-dev-sdk first
  const zai = await getZAI()
  if (zai) {
    try {
      const fullMessages = systemPrompt
        ? [{ role: "system", content: systemPrompt }, ...messages]
        : messages
      const completion = await zai.chat.completions.create({
        messages: fullMessages as any,
        temperature: 0.7,
        max_tokens: 1000,
      })
      return completion.choices[0]?.message?.content || ""
    } catch (e: any) {
      console.error("[AI] z-ai chat failed", e?.message)
    }
  }

  // Fallback: OpenAI-compatible API
  if (process.env.OPENAI_API_KEY || process.env.AI_API_KEY) {
    const apiKey = process.env.OPENAI_API_KEY || process.env.AI_API_KEY
    const baseUrl = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1"
    const model = process.env.AI_MODEL || "gpt-4o-mini"
    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: systemPrompt
            ? [{ role: "system", content: systemPrompt }, ...messages]
            : messages,
          max_tokens: 1000,
        }),
      })
      const data = await res.json()
      return data.choices?.[0]?.message?.content || ""
    } catch (e: any) {
      console.error("[AI] OpenAI fallback failed", e?.message)
    }
  }

  // No provider configured
  return "[AI not configured — set ZAI_API_KEY or OPENAI_API_KEY in .env]"
}

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
