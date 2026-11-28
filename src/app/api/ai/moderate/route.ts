import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/session"
import { errorJson, json } from "@/lib/serialize"
import { aiModerate, isAIConfigured } from "@/lib/ai"
import { handleRouteError } from "@/lib/api-errors"

export async function POST(req: NextRequest) {
  const me = await getSessionUser()
  if (!me) return errorJson("Unauthorized", 401)
  const body = await req.json().catch(() => ({}))
  const text = body?.text
  if (!text || typeof text !== "string") return errorJson("text required", 400)

  if (!isAIConfigured()) {
    return errorJson("AI not configured", 503)
  }

  try {
    const result = await aiModerate(text)
    if (result.parseError) {
      return errorJson(result.reason || "Moderation response could not be parsed", 502)
    }
    return json(result)
  } catch (error) {
    // Finding 15: never echo a provider/SDK exception to the client.
    return handleRouteError(error, 'POST /api/ai/moderate')
  }
}
