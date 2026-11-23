import { NextRequest } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { errorJson, json } from '@/lib/serialize'
import { db } from '@/lib/db'
import { aiChat, isAIConfigured } from '@/lib/ai'
import { rateLimit } from '@/lib/cache'
import { JARA_ID, parseInstructionToPatch, hashConfig, proposalExpiresAt, JARA_DEFAULT_CONFIG } from '@/lib/jara'
import { createHash } from 'crypto'

// POST /api/jara/chat — chat with Jara (text)
// Handles both normal conversation and Super Admin configuration instructions
export async function POST(req: NextRequest) {
  const me = await getSessionUser()
  if (!me) return errorJson('Unauthorized', 401)

  const limited = await rateLimit(`jara-chat:${me.id}`, 30, 60).catch(() => false)
  if (limited === false) return errorJson('Rate limit exceeded', 429)

  let body: any
  try { body = await req.json() } catch { return errorJson('Invalid JSON', 400) }

  const messages: { role: string; content: string }[] = body.messages || []
  const singleMessage: string | undefined = body.message // alt single message
  const chatMessages = messages.length ? messages : (singleMessage ? [{ role: 'user', content: singleMessage }] : [])

  if (!chatMessages.length) return errorJson('Messages required', 400)

  const lastUserMsg = [...chatMessages].reverse().find(m => m.role === 'user')?.content || ''
  const isSuperAdmin = me.role === 'admin' || me.role === 'superadmin'

  // Persist user message as Message with Jara as receiver (for history)
  try {
    await (db as any).message.create({
      data: {
        senderId: me.id,
        receiverId: JARA_ID,
        content: String(lastUserMsg).slice(0, 5000),
        type: 'text',
        status: 'SENT',
      },
    })
  } catch {}

  // Detect Super Admin configuration intent
  const looksLikeConfigInstruction =
    isSuperAdmin &&
    (/(change|update|switch|set|restore|use|make)\s+(your|my|the)?\s*(background|face|avatar|appearance|theme|color|voice|personality|model|style|clothing)/i.test(lastUserMsg) ||
     /jara[,\s]+(change|update|switch|use)/i.test(lastUserMsg))

  if (looksLikeConfigInstruction) {
    // Parse instruction into patch
    const { patch, summary, confidence } = parseInstructionToPatch(lastUserMsg)

    // If we detected something, prepare a proposal (but don't apply)
    if (summary.length > 0 && confidence > 0.35) {
      // Get current live config
      let live = await (db as any).jaraConfig.findFirst({ where: { isLive: true }, orderBy: { version: 'desc' } }).catch(() => null)
      if (!live) {
        live = { ...JARA_DEFAULT_CONFIG } as any
      }

      const proposed: any = { ...live, ...patch }
      // Don't copy id/createdAt etc into hash
      const hashable: any = { ...proposed }
      delete hashable.id; delete hashable.createdAt; delete hashable.updatedAt; delete hashable.createdBy; delete hashable.isLive
      const configHash = hashConfig(hashable)
      const configJson = JSON.stringify(proposed)

      const nextVersion = live.version + 1
      const expiresAt = proposalExpiresAt()

      // Create proposal
      const proposal = await (db as any).jaraProposal.create({
        data: {
          version: nextVersion,
          previousVersion: live.version,
          configJson,
          configHash,
          status: 'pending',
          createdBy: me.id,
          expiresAt,
          changeSummary: summary.join('; '),
        },
      })

      await (db as any).jaraAuditLog.create({
        data: {
          proposalId: proposal.id,
          version: nextVersion,
          action: 'propose',
          actorId: me.id,
          actorRole: me.role,
          detail: `Proposal v${nextVersion} created: ${summary.join('; ')}`,
          ip: req.headers.get('x-forwarded-for') || 'unknown',
          userAgent: req.headers.get('user-agent') || '',
        },
      })

      // Build Jara's understanding response (does NOT apply change)
      const understanding = `I understand you want me to: ${summary.join(', ')}.`

      // Get live config summary for comparison
      const currentSummary = `Current: face=${live.face}, background=${live.background}, theme=${live.theme}, voice=${live.voiceLanguage}, personality=${live.personality}, model=${live.llmModel}`
      const proposedSummary = `Proposed (v${nextVersion}): ${Object.entries(patch).map(([k, v]) => `${k}=${v}`).join(', ')}`

      const reply =
        `${understanding}\n\n` +
        `I've prepared a new configuration proposal (v${nextVersion}). Your current appearance is unchanged — please review the preview.\n\n` +
        `📋 **Current:** ${currentSummary}\n` +
        `✨ **Proposed:** ${proposedSummary}\n\n` +
        `**What will change:**\n${summary.map(s => `• ${s}`).join('\n')}\n\n` +
        `⏰ This proposal expires at ${expiresAt.toLocaleString()}.\n\n` +
        `Do you approve this exact configuration? Reply "Approved. Apply this change." or use the Approve button in the preview.\n\n` +
        `Proposal ID: \`${proposal.id}\` | Hash: \`${configHash.slice(0, 12)}…\``

      // Save Jara's proposal message too
      try {
        await (db as any).message.create({
          data: {
            senderId: JARA_ID,
            receiverId: me.id,
            content: reply,
            type: 'text',
            status: 'SENT',
            metadata: JSON.stringify({ proposalId: proposal.id, configHash, version: nextVersion, kind: 'jara-proposal' }),
          },
        })
      } catch {}

      return json({
        response: reply,
        kind: 'proposal',
        proposal: {
          id: proposal.id,
          version: nextVersion,
          previousVersion: live.version,
          configHash,
          status: 'pending',
          expiresAt: expiresAt.toISOString(),
          changeSummary: summary.join('; '),
          currentConfig: live,
          proposedConfig: proposed,
        },
      })
    }
  }

  // Normal conversation flow (non-config or low-confidence or non-admin)

  // Build Jara personality system prompt from live config
  let jaraConfig: any = null
  try {
    jaraConfig = await (db as any).jaraConfig.findFirst({ where: { isLive: true }, orderBy: { version: 'desc' } })
  } catch {}
  if (!jaraConfig) jaraConfig = { ...JARA_DEFAULT_CONFIG, version: 1 }

  const personalityPrompt =
    jaraConfig.personality === 'professional' ? 'You are professional, concise, and courteous.'
    : jaraConfig.personality === 'playful' ? 'You are playful, warm, and light-hearted.'
    : jaraConfig.personality === 'formal' ? 'You are formal, respectful, and precise.'
    : 'You are friendly, warm, and conversational.'

  const lang = jaraConfig.voiceLanguage || 'bn'
  const langInstruction =
    lang === 'bn' ? 'You can speak Bangla fluently, including conversational Bangla and Banglish. Detect the user language and respond in the same language (Bangla, English, or mixed).'
    : lang === 'en' ? 'Respond in English.'
    : 'Detect user language (Bangla, English, Banglish) and respond accordingly. You are comfortable mixing Bangla and English.'

  const systemPrompt =
    `You are Jara, a friendly AI assistant inside FriendConnect. You have a distinct visual identity (face=${jaraConfig.face}, background=${jaraConfig.background}, theme=${jaraConfig.theme}). ` +
    `${personalityPrompt} ` +
    `${langInstruction} ` +
    `You must clearly identify yourself as AI — never pretend to be human. Keep responses ${jaraConfig.responseLength === 'short' ? 'short (1-2 sentences)' : jaraConfig.responseLength === 'long' ? 'detailed' : 'concise but helpful (2-4 sentences)'}. ` +
    `You are helpful, kind, and remember context within the conversation. If the user speaks Bangla, respond in Bangla. If Banglish, respond in Banglish. If English, respond in English. ` +
    `If the user asks about changing your appearance, voice, or model, explain you can prepare a proposal for the Super Admin to approve — you never change live config automatically.`

  // Try AI provider, fallback to echo-style friendly response
  let aiResponse = ''
  if (isAIConfigured()) {
    try {
      aiResponse = await aiChat(chatMessages as any, systemPrompt)
    } catch (e: any) {
      aiResponse = fallbackReply(lastUserMsg, jaraConfig, e?.message)
    }
  } else {
    aiResponse = fallbackReply(lastUserMsg, jaraConfig, 'AI provider not configured')
  }

  // Save assistant message
  try {
    await (db as any).message.create({
      data: {
        senderId: JARA_ID,
        receiverId: me.id,
        content: String(aiResponse).slice(0, 5000),
        type: 'text',
        status: 'SENT',
      },
    })
  } catch {}

  return json({ response: aiResponse, kind: 'chat', config: { face: jaraConfig.face, background: jaraConfig.background, theme: jaraConfig.theme, version: jaraConfig.version } })
}

function fallbackReply(userMsg: string, cfg: any, reason: string): string {
  const lower = userMsg.toLowerCase()
  // Bangla detection simple
  const isBangla = /[\u0980-\u09FF]/.test(userMsg) || lower.includes('kemon') || lower.includes('valo') || lower.includes('tumi') || lower.includes('ami') || lower.includes('kotha') || lower.includes('bangla')
  if (isBangla) {
    if (lower.includes('kemon acho') || lower.includes('kemon aso')) return 'আমি ভালো আছি, ধন্যবাদ! 😊 আমি Jara — তোমার AI বন্ধু। তুমি কেমন আছো? আমি বাংলায়, ইংরেজিতে বা Banglish-এ কথা বলতে পারি।'
    if (lower.includes('tumi ke')) return 'আমি Jara — FriendConnect-এর AI assistant। আমি তোমাকে সাহায্য করতে এখানে আছি! 🤖'
    if (lower.includes('valo')) return 'খুব ভালো! তোমাকে সাহায্য করতে পেরে ভালো লাগছে। আর কী জানতে চাও?'
    return 'হ্যালো! আমি Jara — তোমার বন্ধু AI। তুমি বাংলায়, ইংরেজিতে বা Banglish-এ যেভাবে খুশি কথা বলতে পারো। কীভাবে সাহায্য করতে পারি? 😊'
  }
  // Greeting
  if (lower.includes('hello') || lower.includes('hi ') || lower.trim() === 'hi' || lower.includes('hey')) {
    return "Hello! I'm Jara — your friendly AI assistant on FriendConnect. 🤖 How can I help you today? I can chat in English, Bangla, or Banglish!"
  }
  if (lower.includes('who are you') || lower.includes('what are you')) {
    return "I'm Jara — an AI assistant built into FriendConnect. I can chat, help you, and join group conversations when invited. How can I assist? 😊"
  }
  if (lower.includes('help')) {
    return "Of course! I can answer questions, summarize chats, translate, or just have a friendly conversation. What do you need help with?"
  }
  // Default friendly echo with context
  return `Thanks for your message! I'm Jara — your AI friend here on FriendConnect. You said: "${userMsg.slice(0, 120)}" — I'd love to help with that! ${reason.includes('not configured') ? '(AI model is in fallback mode — connect an Ollama or API key for smarter replies.)' : ''}`
}
