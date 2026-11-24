import { NextRequest } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { errorJson, json } from '@/lib/serialize'
import { db } from '@/lib/db'
import { aiChat, isAIConfigured } from '@/lib/ai'
import { buildJaraConversationContext } from '@/lib/ai-input'
import { assertJaraEnabled } from '@/lib/jara-admin'
import { rateLimit } from '@/lib/cache'
import { buildJaraSystemPrompt } from '@/lib/jara-prompt'
import { JARA_ID, JARA_DEFAULT_CONFIG } from '@/lib/jara'

// Speech recognition and speech synthesis run in the browser; this endpoint is
// the authenticated text-model bridge and does not claim server-side voice.
export async function POST(req: NextRequest) {
  const me = await getSessionUser()
  if (!me) return errorJson('Unauthorized', 401)
  try {
    await assertJaraEnabled('voice')
  } catch (e: any) {
    return errorJson(e?.status === 503 ? 'Jara AI is currently disabled by a Super Admin.' : (e?.message || 'Jara unavailable'), e?.status || 403)
  }

  const limited = await rateLimit(`jara-voice:${me.id}`, 10, 60).catch(() => null)
  if (limited === null) return errorJson('Voice request protection is temporarily unavailable', 503)
  if (!limited.allowed) return errorJson('Rate limit exceeded', 429)

  let body: any
  try { body = await req.json() } catch { return errorJson('Invalid JSON', 400) }

  const transcript = typeof body.transcript === 'string' ? body.transcript : typeof body.text === 'string' ? body.text : ''
  if (!transcript.trim()) return errorJson('transcript required', 400)
  if (transcript.length > 4000) return errorJson('Transcript is too long', 413)

  // Browser-provided history is intentionally ignored. Reconstruct context from
  // this authenticated user's visible persisted Jara DM, just like text chat.
  // Speech transcripts remain ordinary chat history; this does not enable memory.
  if (!isAIConfigured()) return errorJson('Jara language model is not configured', 503)

  const transcriptText = transcript.trim()
  try {
    await (db as any).message.create({
      data: {
        senderId: me.id,
        receiverId: JARA_ID,
        content: transcriptText.slice(0, 5000),
        type: 'text',
        status: 'SENT',
      },
    })
  } catch {
    // Match Jara text chat behavior: still answer if history persistence is unavailable.
  }

  const now = new Date()
  const persistedRows = await db.message.findMany({
    where: {
      AND: [
        { OR: [{ senderId: me.id, receiverId: JARA_ID }, { senderId: JARA_ID, receiverId: me.id }] },
        { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        { OR: [{ scheduledFor: null }, { scheduledFor: { lte: now } }] },
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: 24,
    select: { senderId: true, receiverId: true, content: true, deletedFor: true, expiresAt: true, scheduledFor: true },
  }).catch(() => [])
  const context = buildJaraConversationContext(persistedRows, me.id, JARA_ID, transcriptText)

  let jaraConfig: any = null
  try {
    jaraConfig = await (db as any).jaraConfig.findFirst({ where: { isLive: true }, orderBy: { version: 'desc' } })
  } catch {}
  if (!jaraConfig) jaraConfig = { ...JARA_DEFAULT_CONFIG, version: 1 }

  const systemPrompt = `${buildJaraSystemPrompt(jaraConfig, 'voice')} Treat the speech transcript as potentially imperfect; if an unclear word changes the meaning, ask a short clarification.`

  try {
    const reply = await aiChat(context, systemPrompt)
    try {
      await (db as any).message.create({
        data: {
          senderId: JARA_ID,
          receiverId: me.id,
          content: String(reply).slice(0, 5000),
          type: 'text',
          status: 'SENT',
        },
      })
    } catch {}
    return json({ reply, transcript: transcriptText })
  } catch {
    return errorJson('Jara language model is temporarily unavailable', 502)
  }
}
