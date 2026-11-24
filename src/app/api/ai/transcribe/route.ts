import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/session"
import { errorJson, json } from "@/lib/serialize"
import { handleRouteError } from '@/lib/api-errors'

// Transcribe an audio file (voice message) to text using z-ai-web-dev-sdk ASR
export async function POST(req: NextRequest) {
  const me = await getSessionUser()
  if (!me) return errorJson("Unauthorized", 401)

  const formData = await req.formData().catch(() => null)
  if (!formData) return errorJson("Expected audio file", 400)
  const file = formData.get("audio") as File | null
  if (!file) return errorJson("No audio file", 400)
  if (!file.type.startsWith("audio/")) return errorJson("File must be audio", 400)
  if (file.size > 25 * 1024 * 1024) return errorJson("File too large (max 25MB)", 413)

  try {
    const ZAI = (await import("z-ai-web-dev-sdk")).default
    const zai: any = await (ZAI as any).create()
    const buffer = Buffer.from(await file.arrayBuffer())
    const base64Audio = buffer.toString("base64")

    let text = ""
    try {
      // Try different ASR method names the SDK might expose (cast to any to avoid TS errors for SDK variations)
      const azai: any = zai
      if (azai.asr?.transcribe) {
        const result = await azai.asr.transcribe({ audio: base64Audio, mime_type: file.type })
        text = result?.text || ""
      } else if (azai.audio?.transcribe) {
        const result = await azai.audio.transcribe({ audio: base64Audio, mime_type: file.type })
        text = result?.text || ""
      } else {
        return errorJson("ASR not available in this SDK version", 501)
      }
    } catch (error) {
      // Provider errors can carry request details and upstream keys; log the
      // cause, return a stable message (finding #15).
      console.error("[ASR] transcription failed", (error as Error)?.message)
      return handleRouteError(error, 'POST /api/ai/transcribe')
    }

    return json({ text })
  } catch (error) {
    console.error("[ASR] error", error)
    return handleRouteError(error, 'POST /api/ai/transcribe')
  }
}
