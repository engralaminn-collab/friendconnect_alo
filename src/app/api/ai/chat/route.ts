import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/session"
import { errorJson, json } from "@/lib/serialize"
import { aiChat, isAIConfigured } from "@/lib/ai"
import { rateLimit } from "@/lib/cache"

export async function POST(req: NextRequest) {
  const me = await getSessionUser()
  if (!me) return errorJson("Unauthorized", 401)

  // Rate limit: 20 AI requests per minute per user
  const limited = await rateLimit(`ai-chat:${me.id}`, 20, 60).catch(() => null)
  if (limited === false) return errorJson("Rate limit exceeded", 429)

  const { messages, systemPrompt } = await req.json()
  if (!Array.isArray(messages) || messages.length === 0) {
    return errorJson("Messages required", 400)
  }

  if (!isAIConfigured()) {
    return errorJson("AI not configured — set ZAI_API_KEY or OPENAI_API_KEY", 503)
  }

  const response = await aiChat(messages, systemPrompt)
  return json({ response })
}
