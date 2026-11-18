import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/session"
import { errorJson, json } from "@/lib/serialize"
import { aiTranslate, isAIConfigured } from "@/lib/ai"

export async function POST(req: NextRequest) {
  const me = await getSessionUser()
  if (!me) return errorJson("Unauthorized", 401)
  const { text, targetLang } = await req.json()
  if (!text || !targetLang) return errorJson("text and targetLang required", 400)

  if (!isAIConfigured()) {
    return errorJson("AI not configured", 503)
  }

  const translated = await aiTranslate(text, targetLang)
  return json({ translated })
}
