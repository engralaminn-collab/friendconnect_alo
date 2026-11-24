import { NextRequest } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { errorJson, json } from '@/lib/serialize'
import { db } from '@/lib/db'
import { aiChat, isAIConfigured } from '@/lib/ai'
import { normalizeChatInput, buildJaraConversationContext } from '@/lib/ai-input'
import { buildJaraSystemPrompt } from '@/lib/jara-prompt'
import { rateLimit } from '@/lib/cache'
import { JARA_ID, parseInstructionToPatch, hashConfig, proposalExpiresAt, JARA_DEFAULT_CONFIG } from '@/lib/jara'
import { getRendererCapability } from '@/lib/jara-renderer'
import { assertJaraEnabled, applyJaraConfigPatch, isSuperAdmin as isSuperAdminRole, writeJaraAudit, requestMeta } from '@/lib/jara-admin'
import { handleRouteError } from '@/lib/api-errors'

// POST /api/jara/chat — chat with Jara (text)
// Handles both normal conversation and Super Admin configuration instructions
export async function POST(req: NextRequest) {
  const me = await getSessionUser()
  if (!me) return errorJson('Unauthorized', 401)

  const limited = await rateLimit(`jara-chat:${me.id}`, 30, 60).catch(() => null)
  if (limited === null) return errorJson('Jara request protection is temporarily unavailable', 503)
  if (!limited.allowed) return errorJson('Rate limit exceeded', 429)

  try {
    await assertJaraEnabled('chat')
  } catch (error) {
    const candidate = error as { status?: number; message?: string }
    if (candidate?.status === 503) {
      return errorJson('Jara AI is currently disabled by a Super Admin.', 503)
    }
    // Policy denials carry a safe reason; anything else is logged and generic.
    if (candidate?.status && candidate.status < 500 && candidate.message) {
      return errorJson(candidate.message, candidate.status)
    }
    return handleRouteError(error, 'POST /api/jara/chat')
  }

  let body: any
  try { body = await req.json() } catch { return errorJson('Invalid JSON', 400) }

  const suppliedMessages = Array.isArray(body.messages)
    ? body.messages
    : typeof body.message === 'string'
      ? [{ role: 'user', content: body.message }]
      : null
  const parsedMessages = normalizeChatInput(suppliedMessages)
  if (!parsedMessages.ok) {
    const status = parsedMessages.error === 'message_too_long' || parsedMessages.error === 'conversation_too_long' ? 413 : 400
    return errorJson('Invalid or oversized conversation', status)
  }
  const chatMessages = parsedMessages.messages
  const lastUserMsg = chatMessages[chatMessages.length - 1].content
  const isSuperAdmin = isSuperAdminRole(me)

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

  const looksLikeMeetingCreate =
    /(create|make|setup|set up|build|schedule|draft).*(custom meeting|meeting|video call|meeting profile|meeting studio)|কাস্টম মিটিং|মিটিং তৈরি|মিটিং প্রোফাইল|নতুন মিটিং/i.test(lastUserMsg)
    && /meeting|মিটিং|video call|ভিডিও কল/i.test(lastUserMsg)

  if (looksLikeMeetingCreate) {
    if (!isSuperAdmin) {
      const refusal = 'Only an authenticated Super Admin can create Jara meeting profiles.'
      await writeJaraAudit({ action: 'attempt_blocked', actorId: me.id, actorRole: me.role, detail: `Blocked non-admin meeting create: ${String(lastUserMsg).slice(0,200)}`, authorizationResult: 'denied', ...requestMeta(req) })
      try { await (db as any).message.create({ data: { senderId: JARA_ID, receiverId: me.id, content: refusal, type: 'text', status: 'SENT' } }) } catch {}
      return json({ response: refusal, kind: 'denied' })
    }
    const { patch, summary, scope } = parseInstructionToPatch(lastUserMsg)
    const titleMatch = lastUserMsg.match(/(?:meeting|মিটিং)\s*[:\-]\s*([^\n,.]+)/i)
    const title = (titleMatch?.[1] || `Custom Meeting ${new Date().toLocaleString()}`).slice(0, 200)
    const meeting = await (db as any).jaraMeetingProfile.create({ data: {
      title,
      purpose: String(lastUserMsg).slice(0, 500),
      meetingType: /interview|ইন্টারভিউ/i.test(lastUserMsg) ? 'interview' : /training|ট্রেনিং/i.test(lastUserMsg) ? 'training' : /class|ক্লাস/i.test(lastUserMsg) ? 'online_class' : /presentation|প্রেজেন্টেশন/i.test(lastUserMsg) ? 'business_presentation' : 'custom_video_call',
      platform: 'internal',
      clothing: patch.clothing ? JSON.stringify({ type: patch.clothing }) : null,
      background: patch.background || null,
      avatarStyle: patch.face || 'professional',
      presentationStyle: (patch as any).communicationStyle || 'professional',
      voiceLanguage: patch.voiceLanguage || 'bn',
      instructions: String(lastUserMsg).slice(0, 5000),
      status: 'draft',
      scope: scope === 'temporary_next_call' ? 'temporary_next_call' : 'meeting_specific',
      rendererStatus: getRendererCapability().mode,
      configSnapshot: JSON.stringify({ patch, summary, source: 'chat' }),
      createdBy: me.id, updatedBy: me.id,
    } }).catch((e:any) => { throw e })
    await writeJaraAudit({ action: 'config_change', actorId: me.id, actorRole: me.role, detail: `Created meeting draft from chat: ${meeting.title}`, newValue: { id: meeting.id, status: meeting.status }, authorizationResult: 'allowed', ...requestMeta(req) })
    const reply = `✅ Meeting draft created (server-confirmed): "${meeting.title}" [${meeting.id}]. Status: draft. ${summary.length ? 'Parsed presentation: ' + summary.join(', ') + '. ' : ''}Renderer is browser fallback; real GPU avatar video track is not configured. Open "Create Custom Meeting / Video Call" to upload reference media, preview, approve, or schedule.`
    try { await (db as any).message.create({ data: { senderId: JARA_ID, receiverId: me.id, content: reply, type: 'text', status: 'SENT' } }) } catch {}
    return json({ response: reply, kind: 'meeting_draft_created', meeting: { id: meeting.id, status: meeting.status, title: meeting.title } })
  }

  const looksLikeConfigInstruction =
    /(change|update|switch|set|restore|use|make|apply|give|put|wear|speak|talk|enable|disable|ফিরিয়ে|পরিবর্তন|করো|করুন|ব্যবহার করো|পোশাক|ব্যাকগ্রাউন্ড|ভাষা|কথা বল|ডিফল্ট)/i.test(lastUserMsg)

  if (looksLikeConfigInstruction) {
    // Privileged config changes: only authenticated Super Admin
    if (!isSuperAdmin) {
      const refusal = 'আমি আপনার অনুরোধটি বুঝতে পেরেছি, কিন্তু এই ধরনের কনফিগারেশন পরিবর্তন শুধুমাত্র authenticated Super Admin করতে পারবেন। / I understood your request, but privileged Jara configuration changes can only be made by an authenticated Super Admin.'
      await writeJaraAudit({ action: 'attempt_blocked', actorId: me.id, actorRole: me.role, detail: `Blocked non-admin config instruction: ${String(lastUserMsg).slice(0, 200)}`, authorizationResult: 'denied', ...requestMeta(req) })
      try { await (db as any).message.create({ data: { senderId: JARA_ID, receiverId: me.id, content: refusal, type: 'text', status: 'SENT' } }) } catch {}
      return json({ response: refusal, kind: 'denied' })
    }

    const { patch, summary, confidence, scope, restoreDefault } = parseInstructionToPatch(lastUserMsg)
    const consequentialKeys = new Set(['llmProvider','llmModel','sttModel','ttsModel','smsEnabled','callsEnabled','meetingsEnabled','allowGroupListening','approvedKnowledgeMode','isEnabled'])
    const hasConsequential = Object.keys(patch).some(k => consequentialKeys.has(k))
    const isAmbiguous = summary.length === 0 || confidence < 0.55

    if (isAmbiguous) {
      const clarify = `I want to make sure I understand correctly before changing anything. You said: "${String(lastUserMsg).slice(0, 200)}". Please clarify what you want me to change (appearance, clothing, background, voice/language, personality, or communication setting), and whether it should be permanent or only for the next call/meeting.`
      try { await (db as any).message.create({ data: { senderId: JARA_ID, receiverId: me.id, content: clarify, type: 'text', status: 'SENT' } }) } catch {}
      return json({ response: clarify, kind: 'clarify' })
    }

    // Temporary next-call: do NOT change default live config
    if (scope === 'temporary_next_call') {
      const live = await (db as any).jaraConfig.findFirst({ where: { isLive: true }, orderBy: { version: 'desc' } }).catch(() => null)
      const base = live || { ...JARA_DEFAULT_CONFIG }
      const profile = await (db as any).jaraAppearanceProfile.create({ data: {
        name: `Next call - ${new Date().toLocaleString()}`,
        description: summary.join('; '),
        profileType: patch.background === 'outdoor' ? 'outdoor' : patch.background === 'alo-office' ? 'office' : 'custom',
        isDefault: false, isTemporary: true,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        face: patch.face || base.face || 'friendly',
        avatar: patch.avatar || base.avatar || 'default',
        background: patch.background || base.background || 'gradient-emerald',
        backgroundUrl: patch.backgroundUrl ?? base.backgroundUrl ?? null,
        theme: patch.theme || base.theme || 'light',
        clothing: patch.clothing || base.clothing || null,
        colors: patch.colors || base.colors || null,
        voiceLanguage: patch.voiceLanguage || base.voiceLanguage || 'bn',
        personality: patch.personality || base.personality || 'friendly',
        communicationStyle: (patch as any).communicationStyle || base.communicationStyle || 'conversational',
        createdBy: me.id, updatedBy: me.id, isActive: true,
      } })
      const sessionType = /audio call|অডিও কল/.test(lastUserMsg.toLowerCase()) ? 'audio_call' : /meeting|মিটিং/.test(lastUserMsg.toLowerCase()) ? 'meeting' : 'video_call'
      await (db as any).jaraCallPresentation.create({ data: {
        sessionType, sessionId: null, roomId: null, profileId: profile.id,
        profileSnapshot: JSON.stringify(profile), isTemporary: true, expiresAt: profile.expiresAt,
        status: 'active', createdBy: me.id,
      } }).catch(() => {})
      await writeJaraAudit({ action: 'config_change', actorId: me.id, actorRole: me.role, detail: `Temporary next-call appearance profile created: ${summary.join('; ')}`, newValue: { profileId: profile.id, scope, patch }, authorizationResult: 'allowed', changeReason: lastUserMsg.slice(0, 300), ...requestMeta(req) })
      const reply = `বুঝেছি। / Understood. I prepared a temporary appearance for your next call/meeting: ${summary.join(', ')}. Your default appearance is unchanged. This temporary profile expires at ${profile.expiresAt?.toLocaleString()} or after it is used.`
      try { await (db as any).message.create({ data: { senderId: JARA_ID, receiverId: me.id, content: reply, type: 'text', status: 'SENT', metadata: JSON.stringify({ kind: 'temporary-profile', profileId: profile.id }) } }) } catch {}
      return json({ response: reply, kind: 'applied_temporary', profile })
    }

    // Consequential changes: proposal flow for explicit review
    if (hasConsequential) {
      let live = await (db as any).jaraConfig.findFirst({ where: { isLive: true }, orderBy: { version: 'desc' } }).catch(() => null)
      if (!live) live = { ...JARA_DEFAULT_CONFIG } as any
      const proposed: any = { ...live, ...patch }
      const hashable: any = { ...proposed }
      delete hashable.id; delete hashable.createdAt; delete hashable.updatedAt; delete hashable.createdBy; delete hashable.isLive
      const configHash = hashConfig(hashable)
      const nextVersion = (live.version || 1) + 1
      const expiresAt = proposalExpiresAt()
      const proposal = await (db as any).jaraProposal.create({ data: { version: nextVersion, previousVersion: live.version, configJson: JSON.stringify(proposed), configHash, status: 'pending', createdBy: me.id, expiresAt, changeSummary: summary.join('; ') } })
      await writeJaraAudit({ action: 'propose', actorId: me.id, actorRole: me.role, proposalId: proposal.id, version: nextVersion, detail: `Proposal created for consequential change: ${summary.join('; ')}`, authorizationResult: 'pending', ...requestMeta(req) })
      const reply = `I understand: ${summary.join(', ')}. Because this is a consequential/security-sensitive change, I prepared proposal v${nextVersion} for explicit review before applying it. Proposal ID: \`${proposal.id}\` | Hash: \`${configHash.slice(0,12)}…\``
      try { await (db as any).message.create({ data: { senderId: JARA_ID, receiverId: me.id, content: reply, type: 'text', status: 'SENT', metadata: JSON.stringify({ proposalId: proposal.id, kind: 'jara-proposal' }) } }) } catch {}
      return json({ response: reply, kind: 'proposal', proposal: { id: proposal.id, version: nextVersion, configHash, status: 'pending', changeSummary: summary.join('; ') } })
    }

    // Routine reversible Super Admin change: apply directly
    try {
      const applied = await applyJaraConfigPatch({ actor: { id: me.id, role: me.role }, patch, reason: lastUserMsg.slice(0, 300), source: 'chat', req })
      const reply = restoreDefault
        ? `Done. I restored my approved default appearance/configuration. (Live config v${applied.version}, applied after server confirmation.)`
        : `Done. I applied your requested change: ${summary.join(', ')}. (Live config v${applied.version}, applied after server confirmation${scope === 'persistent' ? ', saved as persistent/default' : ''}.)`
      try { await (db as any).message.create({ data: { senderId: JARA_ID, receiverId: me.id, content: reply, type: 'text', status: 'SENT', metadata: JSON.stringify({ kind: 'config-applied', version: applied.version }) } }) } catch {}
      return json({ response: reply, kind: 'applied', config: applied.config, version: applied.version, changeSummary: summary })
    } catch (e: any) {
      await writeJaraAudit({ action: 'config_change', actorId: me.id, actorRole: me.role, detail: `Direct apply failed: ${e?.message}`, authorizationResult: 'denied', changeReason: lastUserMsg.slice(0, 300), ...requestMeta(req) })
      const errReply = `I understood your request (${summary.join(', ')}), but I could not apply it: ${e?.message || 'unknown error'}. No configuration was reported as applied.`
      try { await (db as any).message.create({ data: { senderId: JARA_ID, receiverId: me.id, content: errReply, type: 'text', status: 'SENT' } }) } catch {}
      return json({ response: errReply, kind: 'error' }, 500)
    }
  }

  // Normal conversation flow (non-config or low-confidence or non-admin)

  // Build Jara personality system prompt from live config
  let jaraConfig: any = null
  try {
    jaraConfig = await (db as any).jaraConfig.findFirst({ where: { isLive: true }, orderBy: { version: 'desc' } })
  } catch {}
  if (!jaraConfig) jaraConfig = { ...JARA_DEFAULT_CONFIG, version: 1 }

  const systemPrompt = buildJaraSystemPrompt(jaraConfig, 'chat')

  if (!isAIConfigured()) return errorJson('Jara language model is not configured', 503)

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
  const serverContext = buildJaraConversationContext(persistedRows, me.id, JARA_ID, lastUserMsg)

  let aiResponse: string
  try {
    // The browser history is never forwarded to the provider; context comes
    // from this authenticated user's persisted Jara direct-message thread.
    aiResponse = await aiChat(serverContext, systemPrompt)
  } catch {
    return errorJson('Jara language model is temporarily unavailable', 502)
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
