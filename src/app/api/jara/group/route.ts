import { NextRequest } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { errorJson, json } from '@/lib/serialize'
import { db } from '@/lib/db'
import { JARA_ID } from '@/lib/jara'
import { aiChat, isAIConfigured } from '@/lib/ai'
import { assertJaraEnabled } from '@/lib/jara-admin'
import { rateLimit } from '@/lib/cache'
import { buildJaraSystemPrompt } from '@/lib/jara-prompt'
import { buildJaraGroupConversationContext, isMessageDeletedForUser } from '@/lib/ai-input'

// POST /api/jara/group — Jara responds in a group (requires consent + membership)
export async function POST(req: NextRequest) {
  const me = await getSessionUser()
  if (!me) return errorJson('Unauthorized', 401)
  try { await assertJaraEnabled('group') } catch (e: any) { return errorJson(e?.status === 503 ? 'Jara AI is currently disabled by a Super Admin.' : (e?.message || 'Jara unavailable'), e?.status || 403) }
  const limited = await rateLimit(`jara-group:${me.id}`, 15, 60).catch(() => null)
  if (limited === null) return errorJson('Group AI request protection is temporarily unavailable', 503)
  if (!limited.allowed) return errorJson('Rate limit exceeded', 429)

  let body: any
  try { body = await req.json() } catch { return errorJson('Invalid JSON', 400) }

  const groupId = typeof body.groupId === 'string' ? body.groupId : ''
  const messageId = typeof body.messageId === 'string' ? body.messageId : ''

  if (!groupId) return errorJson('groupId required', 400)
  if (!messageId) return errorJson('messageId required', 400)

  // Verify user is a member before looking up the group message.
  const membership = await (db as any).groupMember.findUnique({
    where: { groupId_userId: { groupId, userId: me.id } },
  }).catch(() => null)
  if (!membership) return errorJson('Not a member of this group', 403)

  // Use the persisted message, not caller-supplied text, as the triggering turn.
  // This prevents a client from bypassing delete-for-me by resubmitting hidden content.
  const trigger = await (db as any).message.findUnique({ where: { id: messageId } }).catch(() => null)
  if (!trigger || trigger.groupId !== groupId || isMessageDeletedForUser(trigger, me.id)) {
    return errorJson('Message not found', 404)
  }
  const message = typeof trigger.content === 'string' ? trigger.content : ''
  if (!message.trim()) return errorJson('message required', 400)
  if (message.length > 4000) return errorJson('Message is too long', 413)
  const mentionJara = /(?:^|\W)@?jara\b/i.test(message) || message.includes('জারা')

  // Check Jara consent for this group
  const consent = await (db as any).jaraGroupConsent.findUnique({ where: { groupId } }).catch(() => null)
  if (!consent || !consent.enabled) {
    return errorJson('Jara is not enabled in this group. Ask an admin to invite Jara.', 403)
  }

  // Check if Jara is member of group
  const jaraMember = await (db as any).groupMember.findUnique({
    where: { groupId_userId: { groupId, userId: JARA_ID } },
  }).catch(() => null)
  if (!jaraMember) return errorJson('Jara is not a member of this group', 403)

  // Only respond if mentioned or group setting allows auto-response (we require mention for privacy)
  if (!mentionJara) {
    return json({ skipped: true, reason: 'Jara only responds when mentioned (@Jara) in groups' })
  }

  // Fetch recent group messages for context
  const now = new Date()
  const recentMessages = await (db as any).message.findMany({
    where: {
      AND: [
        { groupId },
        { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        { OR: [{ scheduledFor: null }, { scheduledFor: { lte: now } }] },
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
  }).catch(() => [])
  const group = await (db as any).group.findUnique({ where: { id: groupId } }).catch(() => null)
  const providerContext = buildJaraGroupConversationContext(
    recentMessages.reverse(),
    me.id,
    JARA_ID,
    String(group?.name || 'Group'),
    message,
  )

  if (!isAIConfigured()) return errorJson('Jara language model is not configured', 503)

  let reply: string
  try {
    reply = await aiChat(
      [{ role: 'user', content: providerContext }],
      buildJaraSystemPrompt({}, 'group')
    )
  } catch {
    return errorJson('Jara language model is temporarily unavailable', 502)
  }

  // Persist Jara group message
  const msg = await (db as any).message.create({
    data: {
      senderId: JARA_ID,
      groupId,
      content: reply.slice(0, 2000),
      type: 'text',
      status: 'SENT',
    },
  })

  return json({ reply, message: { id: msg.id, content: reply, groupId, senderId: JARA_ID, createdAt: msg.createdAt } })
}
