import { NextRequest } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { errorJson, json } from '@/lib/serialize'
import { aiChat, isAIConfigured } from '@/lib/ai'
import { assertJaraEnabled } from '@/lib/jara-admin'

// POST /api/jara/voice — transcribe (if audio provided) + generate Jara reply
// In this self-hosted browser-based architecture, STT happens client-side (Web Speech API / Whisper.cpp)
// and TTS happens client-side (Web Speech API / Piper). This endpoint is the LLM bridge.
export async function POST(req: NextRequest) {
  const me = await getSessionUser()
  if (!me) return errorJson('Unauthorized', 401)
  try { await assertJaraEnabled('voice') } catch (e: any) { return errorJson(e?.status === 503 ? 'Jara AI is currently disabled by a Super Admin.' : (e?.message || 'Jara unavailable'), e?.status || 403) }

  let body: any
  try { body = await req.json() } catch { return errorJson('Invalid JSON', 400) }

  const transcript: string = body.transcript || body.text || ''
  const history: { role: string; content: string }[] = body.history || []

  if (!transcript.trim()) return errorJson('transcript required', 400)

  // Build prompt with voice context
  const systemPrompt =
    `You are Jara — a warm, human-like AI companion on FriendConnect. You are currently in a voice call. ` +
    `Respond naturally, conversationally, with appropriate length for speech (2-4 sentences usually). ` +
    `You can understand Bangla, English, and Banglish — detect the user's language and reply in the same language. ` +
    `If the user speaks Bangla, reply in Bangla. Be helpful, friendly, and remember you are AI — never claim to be human. ` +
    `This is a voice transcription, so it may have minor errors — interpret generously.`

  const messages = [...history.slice(-10), { role: 'user', content: transcript }]

  let reply = ''
  if (isAIConfigured()) {
    try {
      reply = await aiChat(messages as any, systemPrompt)
    } catch (e: any) {
      reply = fallbackVoice(transcript)
    }
  } else {
    reply = fallbackVoice(transcript)
  }

  return json({ reply, transcript })
}

function fallbackVoice(transcript: string): string {
  const lower = transcript.toLowerCase()
  if (/[\u0980-\u09FF]/.test(transcript) || lower.includes('kemon') || lower.includes('valo')) {
    return 'ধন্যবাদ! আমি তোমার কথা শুনতে পাচ্ছি। তুমি খুব সুন্দর করে বলেছো! আর কী বলতে চাও?'
  }
  if (lower.includes('hello') || lower.includes('hi')) return "Hello! I can hear you clearly. How can I help you today?"
  return `I heard you say: "${transcript.slice(0, 100)}". I'm Jara, your AI friend — nice to talk with you!`
}
