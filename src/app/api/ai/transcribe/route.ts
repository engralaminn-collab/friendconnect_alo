import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/session"
import { errorJson, json } from "@/lib/serialize"
import { handleRouteError } from '@/lib/api-errors'
import { getVoiceCapability, transcribeAudioServer } from '@/lib/jara-voice'

export async function POST(req: NextRequest) {
  const me = await getSessionUser()
  if (!me) return errorJson("Unauthorized", 401)

  const formData = await req.formData().catch(() => null)
  if (!formData) return errorJson("Expected audio file", 400)
  const file = formData.get("audio") as File | null
  if (!file) return errorJson("No audio file", 400)
  if (!file.type.startsWith("audio/")) return errorJson("File must be audio", 400)
  if (file.size > 25 * 1024 * 1024) return errorJson("File too large (max 25MB)", 413)

  const buffer = Buffer.from(await file.arrayBuffer())
  const lang = typeof formData.get("language") === "string" ? String(formData.get("language")) : undefined

  const cap = getVoiceCapability()
  if (cap.stt.configured) {
    const result = await transcribeAudioServer(buffer, file.name || "audio.webm", file.type, lang)
    if (!result.ok) {
      return errorJson(result.error || "Transcription failed", result.httpStatus || 502)
    }
    return json({ text: result.text, provider: result.provider })
  }

  try {
    const ZAI = (await import("z-ai-web-dev-sdk")).default
    const zai: any = await (ZAI as any).create()
    const base64Audio = buffer.toString("base64")

    const azai: any = zai
    if (azai.asr?.transcribe) {
      const result = await azai.asr.transcribe({ audio: base64Audio, mime_type: file.type })
      return json({ text: result?.text || "", provider: "zai_asr" })
    }
    if (azai.audio?.transcribe) {
      const result = await azai.audio.transcribe({ audio: base64Audio, mime_type: file.type })
      return json({ text: result?.text || "", provider: "zai_audio" })
    }
    return errorJson("No server ASR configured (set JARA_ASR_URL / FASTER_WHISPER_URL or JARA_VOICE_USE_OPENAI=true)", 503)
  } catch (error) {
    console.error("[ASR] error", (error as Error)?.message)
    return handleRouteError(error, 'POST /api/ai/transcribe')
  }
}
