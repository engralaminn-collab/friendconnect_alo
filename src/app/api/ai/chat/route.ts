import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/session"
import { errorJson, json } from "@/lib/serialize"
import { aiChat, isAIConfigured } from "@/lib/ai"
import { normalizeChatInput } from "@/lib/ai-input"
import { rateLimit } from "@/lib/cache"

const AI_ASSISTANT_PROMPT =
  "You are FriendConnect's AI assistant. Be accurate, natural, and concise for simple questions. " +
  "For complex requests, explain important assumptions, ask only for essential missing details, and distinguish suggestions from actions. " +
  "You are an AI, not a human. Never claim that you used a tool or completed an action unless the application confirms it. " +
  "You have no tools in this chat endpoint and cannot perform external actions."

export async function POST(req: NextRequest) {
  const me = await getSessionUser()
  if (!me) return errorJson("Unauthorized", 401)

  const limited = await rateLimit(`ai-chat:${me.id}`, 20, 60).catch(() => null)
  if (limited === null) return errorJson("AI request protection is temporarily unavailable", 503)
  if (!limited.allowed) return errorJson("Rate limit exceeded", 429)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorJson("Invalid JSON", 400)
  }
  const parsed = normalizeChatInput((body as { messages?: unknown } | null)?.messages)
  if (!parsed.ok) {
    const status = parsed.error === 'message_too_long' || parsed.error === 'conversation_too_long' ? 413 : 400
    return errorJson("Invalid or oversized conversation", status)
  }

  if (!isAIConfigured()) return errorJson("AI is not configured", 503)

  try {
    // The system prompt is server-owned. Ignore any client-supplied prompt.
    const response = await aiChat(parsed.messages, AI_ASSISTANT_PROMPT)
    return json({ response })
  } catch {
    return errorJson("The configured AI provider is unavailable", 502)
  }
}
