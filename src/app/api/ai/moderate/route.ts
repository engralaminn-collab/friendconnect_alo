import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/session"
import { errorJson, json } from "@/lib/serialize"
import { aiModerate, isAIConfigured } from "@/lib/ai"

export async function POST(req: NextRequest) {
  const me = await getSessionUser()
  if (!me) return errorJson("Unauthorized", 401)
  const { text } = await req.json()
  if (!text) return errorJson("text required", 400)

  if (!isAIConfigured()) {
    return errorJson("AI not configured", 503)
  }

  const result = await aiModerate(text)
  return json(result)
}
