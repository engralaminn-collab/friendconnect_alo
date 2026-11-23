import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/session"
import { errorJson, json } from "@/lib/serialize"

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
    } catch (e: any) {
      console.error("[ASR] transcription failed", e?.message)
      return errorJson(`Transcription failed: ${e?.message}`, 500)
    }

    return json({ text })
  } catch (e: any) {
    console.error("[ASR] error", e)
    return errorJson(`Transcription failed: ${e?.message}`, 500)
  }
}
