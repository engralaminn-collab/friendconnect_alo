/**
 * Jara as a real participant in FriendConnect messaging.
 *
 * Why this exists: Jara had a dedicated chat page (`/api/jara/chat`) and nothing
 * else. A human could open a direct conversation with Jara, type a message in the
 * normal chat UI, watch it appear — and never get a reply, because the messaging
 * endpoints only reconciled permissions for Jara (`isJaraId`) and returned. Jara
 * was a contact card with a separate chatbot bolted on, not a user.
 *
 * This module is the bridge between the ordinary message store and the AI
 * gateway. It is called after a message has already been persisted by one of the
 * real messaging paths (`POST /api/messages`, `POST /api/conversations/:id/messages`,
 * and the Socket.IO `message:send` handler via `/api/jara/respond`), so Jara's
 * answer is an ordinary `Message` row in the same conversation: it paginates,
 * renders, notifies, respects delete-for-me and shows up in the conversation list
 * like every other message.
 *
 * Non-negotiable properties:
 * - Jara only answers where it is an authorized participant (DM receiver, or a
 *   conversation/group it was explicitly added to). It never reads another
 *   pair's conversation.
 * - One reply per source message. Both the REST and the socket trigger can fire
 *   for the same message; the metadata idempotency key makes the second one a
 *   no-op.
 * - No canned answers. If the provider is missing or fails, the user gets an
 *   explicit "inference unavailable" notice flagged as such, never a fake reply
 *   pretending to be model output.
 * - Group replies require an explicit mention and an enabled `JaraGroupConsent`.
 */
import { db } from '@/lib/db'
import { aiChat, getAIProvider, isAIConfigured } from '@/lib/ai'
import { buildJaraGroupConversationContext } from '@/lib/ai-input'
import { buildJaraSystemPrompt } from '@/lib/jara-prompt'
import { JARA_ID } from '@/lib/jara'
import { getLiveJaraConfig, writeJaraAudit } from '@/lib/jara-admin'
import { emitRealtimeToUsers } from '@/lib/realtime-emit'
import { rateLimit } from '@/lib/cache'

export type JaraReplyReason =
  | 'not_found'
  | 'not_addressed'
  | 'not_participant'
  | 'jara_disabled'
  | 'duplicate'
  | 'rate_limited'
  | 'provider_unavailable'
  | 'empty_response'

export interface JaraReplyMessage {
  id: string
  conversationId: string | null
  groupId: string | null
  senderId: string
  receiverId: string | null
  content: string
  type: string
  createdAt: string
  metadata: string | null
}

export interface JaraReplyOutcome {
  replied: boolean
  reason?: JaraReplyReason
  message?: JaraReplyMessage
}

/** `@Jara`, `jara`, or the Bangla name. Matched case-insensitively. */
const JARA_MENTION = /@jara\b|(^|[^\p{L}\p{N}_])jara([^\p{L}\p{N}_]|$)|জারা/iu

/** Replies per human per window. A chat partner should not be a denial-of-service. */
const REPLY_LIMIT = 30
const REPLY_WINDOW_SECONDS = 60

/** Serializes concurrent triggers (REST + socket) for the same source message. */
const inFlight = new Map<string, Promise<JaraReplyOutcome>>()

const UNAVAILABLE_NOTICE =
  'Jara এখন উত্তর দিতে পারছে না — কোনো AI প্রোভাইডার কনফিগার করা নেই বা প্রোভাইডার সাড়া দিচ্ছে না। ' +
  '/ Jara cannot reply right now: no AI provider is configured, or the configured provider is not responding. ' +
  '(inference: unavailable)'

type SourceMessage = {
  id: string
  senderId: string
  receiverId: string | null
  groupId: string | null
  conversationId: string | null
  content: string
  deletedFor: string | null
  metadata: string | null
}

function isDeletedForEveryone(message: { deletedFor?: string | null }): boolean {
  return String(message.deletedFor || '').split(',').includes('everyone')
}

/** Users that should see the reply: the whole conversation, or just the DM peer. */
async function audienceFor(message: SourceMessage): Promise<string[]> {
  if (message.conversationId) {
    const members = await db.conversationMember
      .findMany({ where: { conversationId: message.conversationId }, select: { userId: true } })
      .catch(() => [])
    const ids = members.map((m: { userId: string }) => m.userId).filter((id: string) => id !== JARA_ID)
    return ids.length ? ids : [message.senderId]
  }
  return [message.senderId]
}

/**
 * Is Jara an authorized participant of the thread this message belongs to?
 * A direct message addressed to Jara counts; anything else needs a membership
 * row, which is the same authorization every other message read uses.
 */
async function jaraParticipates(message: SourceMessage): Promise<boolean> {
  if (message.receiverId === JARA_ID) return true
  if (message.conversationId) {
    const member = await db.conversationMember
      .findUnique({
        where: { conversationId_userId: { conversationId: message.conversationId, userId: JARA_ID } },
        select: { conversationId: true },
      })
      .catch(() => null)
    return Boolean(member)
  }
  if (message.groupId) {
    const member = await db.groupMember
      .findUnique({ where: { groupId_userId: { groupId: message.groupId, userId: JARA_ID } }, select: { groupId: true } })
      .catch(() => null)
    return Boolean(member)
  }
  return false
}

/** A group reply needs an enabled consent row *and* an explicit mention. */
async function groupAllowsReply(message: SourceMessage): Promise<boolean> {
  if (!message.groupId) return true
  if (!JARA_MENTION.test(message.content || '')) return false
  const consent = await db.jaraGroupConsent
    .findFirst({ where: { groupId: message.groupId, enabled: true } })
    .catch(() => null)
  return Boolean(consent)
}

/** Conversation history the model may see, with per-user deletion respected. */
async function buildContext(message: SourceMessage): Promise<{ role: 'user' | 'assistant'; content: string }[]> {
  const now = new Date()
  if (message.groupId) {
    const rows = await db.message
      .findMany({
        where: { groupId: message.groupId },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { senderId: true, content: true, deletedFor: true, expiresAt: true, scheduledFor: true },
      })
      .catch(() => [])
    const group = await db.group
      .findUnique({ where: { id: message.groupId }, select: { name: true } })
      .catch(() => null)
    return [
      {
        role: 'user',
        content: buildJaraGroupConversationContext(
          rows,
          message.senderId,
          JARA_ID,
          String(group?.name || 'Group'),
          message.content,
          now.getTime(),
        ),
      },
    ]
  }

  const where = message.conversationId
    ? { conversationId: message.conversationId }
    : {
        OR: [
          { senderId: message.senderId, receiverId: JARA_ID },
          { senderId: JARA_ID, receiverId: message.senderId },
        ],
      }
  const rows = await db.message
    .findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { senderId: true, content: true, deletedFor: true, metadata: true, expiresAt: true, scheduledFor: true },
    })
    .catch(() => [])

  const turns: { role: 'user' | 'assistant'; content: string }[] = []
  for (const row of [...rows].reverse()) {
    if (isDeletedForEveryone(row)) continue
    if (String(row.deletedFor || '').split(',').includes(message.senderId)) continue
    if (row.expiresAt && new Date(row.expiresAt) <= now) continue
    if (row.scheduledFor && new Date(row.scheduledFor) > now) continue
    // Earlier "inference unavailable" notices are not conversation content.
    if (String(row.metadata || '').includes('"inference":"unavailable"')) continue
    const content = typeof row.content === 'string' ? row.content.trim() : ''
    if (!content || content.length > 8000) continue
    turns.push({ role: row.senderId === JARA_ID ? 'assistant' : 'user', content: content.slice(0, 4000) })
  }
  if (!turns.length || turns[turns.length - 1].role !== 'user') {
    turns.push({ role: 'user', content: message.content.slice(0, 4000) })
  }
  return turns.slice(-16)
}

async function persistReply(
  message: SourceMessage,
  content: string,
  metadata: Record<string, unknown>,
): Promise<JaraReplyMessage> {
  const created = await db.message.create({
    data: {
      conversationId: message.conversationId,
      senderId: JARA_ID,
      // Keep `receiverId` for direct threads so the DM-oriented endpoints
      // (receipts, `?userId=` history) stay meaningful; a group leaves it null.
      receiverId: message.groupId ? null : message.senderId,
      groupId: message.groupId,
      content: content.slice(0, 5000),
      type: metadata.inference === 'unavailable' ? 'system' : 'text',
      status: 'SENT',
      replyToId: message.id,
      metadata: JSON.stringify({ jara: true, ...metadata }),
    },
  })

  // Jara read the message it answers: the sender's bubble shows "seen" like a
  // human peer's would.
  await db.message
    .update({ where: { id: message.id }, data: { status: 'SEEN', seenAt: new Date() } })
    .catch(() => {})

  const payload = {
    id: created.id,
    senderId: created.senderId,
    receiverId: created.receiverId ?? null,
    groupId: created.groupId ?? null,
    conversationId: created.conversationId ?? null,
    content: created.content,
    type: created.type,
    createdAt: created.createdAt instanceof Date ? created.createdAt.toISOString() : String(created.createdAt),
    sender: { id: JARA_ID, username: 'jara', name: 'Jara', avatarUrl: '/jara-avatar.svg' },
  }
  await emitRealtimeToUsers(await audienceFor(message), 'message:new', payload)

  await db.notification
    .create({
      data: {
        userId: message.senderId,
        type: 'message',
        title: 'Jara replied',
        body: created.content.slice(0, 140),
        data: JSON.stringify({ conversationId: message.conversationId, messageId: created.id, from: JARA_ID }),
      },
    })
    .catch(() => {})

  return {
    id: created.id,
    conversationId: created.conversationId ?? null,
    groupId: created.groupId ?? null,
    senderId: created.senderId,
    receiverId: created.receiverId ?? null,
    content: created.content,
    type: created.type,
    createdAt: payload.createdAt,
    metadata: created.metadata ?? null,
  }
}

async function alreadyAnswered(sourceMessageId: string): Promise<boolean> {
  const existing = await db.message
    .findFirst({
      where: { senderId: JARA_ID, metadata: { contains: `"sourceMessageId":"${sourceMessageId}"` } },
      select: { id: true },
    })
    .catch(() => null)
  return Boolean(existing)
}

async function reply(sourceMessageId: string): Promise<JaraReplyOutcome> {
  const message = (await db.message
    .findUnique({ where: { id: sourceMessageId } })
    .catch(() => null)) as SourceMessage | null
  if (!message) return { replied: false, reason: 'not_found' }
  if (message.senderId === JARA_ID) return { replied: false, reason: 'not_addressed' }
  if (isDeletedForEveryone(message)) return { replied: false, reason: 'not_addressed' }
  if (!(await jaraParticipates(message))) return { replied: false, reason: 'not_participant' }
  if (!(await groupAllowsReply(message))) return { replied: false, reason: 'not_addressed' }

  if (await alreadyAnswered(message.id)) return { replied: false, reason: 'duplicate' }

  const config = await getLiveJaraConfig().catch(() => null)
  if (config && config.isEnabled === false) return { replied: false, reason: 'jara_disabled' }

  const limited = await rateLimit(`jara-reply:${message.senderId}`, REPLY_LIMIT, REPLY_WINDOW_SECONDS).catch(() => null)
  if (limited && !limited.allowed) {
    await writeJaraAudit({
      action: 'attempt_blocked',
      actorId: message.senderId,
      detail: 'Jara reply rate limit hit',
      authorizationResult: 'denied',
    }).catch(() => {})
    return { replied: false, reason: 'rate_limited' }
  }

  const provider = getAIProvider()
  if (!isAIConfigured()) {
    const notice = await persistReply(message, UNAVAILABLE_NOTICE, {
      inference: 'unavailable',
      provider: 'none',
      sourceMessageId: message.id,
    })
    return { replied: true, reason: 'provider_unavailable', message: notice }
  }

  const channel = message.groupId ? 'group' : 'chat'
  const systemPrompt = buildJaraSystemPrompt(config || {}, channel)
  const context = await buildContext(message)

  let answer: string
  try {
    answer = await aiChat(context, systemPrompt)
  } catch {
    const notice = await persistReply(message, UNAVAILABLE_NOTICE, {
      inference: 'unavailable',
      provider,
      sourceMessageId: message.id,
    })
    return { replied: true, reason: 'provider_unavailable', message: notice }
  }

  const trimmed = String(answer || '').trim()
  if (!trimmed) {
    return { replied: false, reason: 'empty_response' }
  }

  const replyMessage = await persistReply(message, trimmed, {
    inference: 'provider',
    provider,
    model: process.env.OLLAMA_MODEL || process.env.AI_MODEL || null,
    sourceMessageId: message.id,
  })

  await writeJaraAudit({
    action: 'ai_reply',
    actorId: JARA_ID,
    actorRole: 'jara',
    detail: `Replied to message ${message.id} in ${message.conversationId ? `conversation ${message.conversationId}` : `direct thread with ${message.senderId}`}`,
    newValue: { replyId: replyMessage.id, provider },
    authorizationResult: 'allowed',
  }).catch(() => {})

  return { replied: true, message: replyMessage }
}

/**
 * Generate Jara's answer to an already-persisted message, exactly once.
 * Safe to call from several triggers for the same message id.
 */
export async function replyAsJaraForMessage(sourceMessageId: string): Promise<JaraReplyOutcome> {
  if (typeof sourceMessageId !== 'string' || !sourceMessageId.trim()) {
    return { replied: false, reason: 'not_found' }
  }
  const key = sourceMessageId.trim()
  const pending = inFlight.get(key)
  if (pending) return pending

  const task = reply(key)
    .catch((): JaraReplyOutcome => ({ replied: false, reason: 'provider_unavailable' }))
    .finally(() => inFlight.delete(key))
  inFlight.set(key, task)
  return task
}

/**
 * Trigger the reply without blocking the HTTP response that stored the message.
 * The user's client receives the answer over Socket.IO (or on the next fetch);
 * the store is the source of truth either way.
 */
export function scheduleJaraReply(sourceMessageId: string): void {
  void replyAsJaraForMessage(sourceMessageId).catch(() => {})
}

export const JARA_UNAVAILABLE_NOTICE = UNAVAILABLE_NOTICE
