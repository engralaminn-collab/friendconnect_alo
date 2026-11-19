import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/session"
import { errorJson, json } from "@/lib/serialize"
import { getAIStatus } from "@/lib/ai"

// GET: returns the current AI provider status and available models
export async function GET(_req: NextRequest) {
  const me = await getSessionUser()
  if (!me) return errorJson("Unauthorized", 401)
  return json(getAIStatus())
}
