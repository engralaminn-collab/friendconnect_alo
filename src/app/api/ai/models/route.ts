import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/session"
import { errorJson, json } from "@/lib/serialize"
import { getAvailableModels, getAIProvider } from "@/lib/ai"

// GET: returns available AI models for the current provider
export async function GET(_req: NextRequest) {
  const me = await getSessionUser()
  if (!me) return errorJson("Unauthorized", 401)
  return json({
    provider: getAIProvider(),
    models: getAvailableModels(),
  })
}
