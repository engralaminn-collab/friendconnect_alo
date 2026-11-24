import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { json } from '@/lib/serialize'
import { handleRouteError, RouteError, invalid } from '@/lib/api-errors'
import { isMessageParticipant } from '@/lib/socket-security.cjs'
import { emitRealtimeToUsers } from '@/lib/realtime-emit'

/**
 * Reaction endpoints.
 *
 * Finding #4: neither method checked whether the caller could see the message,
 * so any authenticated user could react to (and thereby confirm the existence
 * of) a message id in a conversation they were not part of. The socket path
 * already called `isMessageParticipant`; these routes now use the same helper,
 * which is what keeps REST and socket authorization from drifting apart.
 */

/** Emoji allow-list: a reaction is a single pictograph plus optional modifiers. */
const EMOJI_PATTERN = /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|[\u200d\ufe0f])+$/u
const MAX_EMOJI_LENGTH = 16

function validateEmoji(raw: unknown): string {
  const emoji = String(raw ?? '').trim()
  if (!emoji) throw invalid('emoji required')
  if (emoji.length > MAX_EMOJI_LENGTH || !EMOJI_PATTERN.test(emoji)) throw invalid('Unsupported emoji')
  return emoji
}

/** Load the message and assert the caller participates in its conversation. */
async function loadMessageForParticipant(messageId: string, userId: string) {
  const message = await db.message.findUnique({ where: { id: messageId } })
  // Do not distinguish "missing" from "not yours": both are 404 so message ids
  // cannot be probed for existence.
  if (!message) throw new RouteError('NOT_FOUND', 'Message not found.')
  if (!(await isMessageParticipant(db, userId, message))) {
    throw new RouteError('NOT_FOUND', 'Message not found.')
  }
  return message
}

async function reactionRecipients(message: { senderId: string; receiverId?: string | null; groupId?: string | null; conversationId?: string | null }) {
  if (message.conversationId) {
    const members = await db.conversationMember.findMany({ where: { conversationId: message.conversationId }, select: { userId: true } })
    return members.map((m) => m.userId)
  }
  if (message.groupId) {
    const members = await db.groupMember.findMany({ where: { groupId: message.groupId }, select: { userId: true } })
    return members.map((m) => m.userId)
  }
  return [message.senderId, message.receiverId].filter((v): v is string => typeof v === 'string' && v.length > 0)
}

// POST add a reaction (REST fallback; primary path is socket reaction:add)
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const me = await getSessionUser()
    if (!me) throw new RouteError('UNAUTHORIZED')

    const { id } = await params
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') throw invalid('Invalid request body')
    const emoji = validateEmoji((body as Record<string, unknown>).emoji)

    const message = await loadMessageForParticipant(id, me.id)

    await db.messageReaction.upsert({
      where: { messageId_userId_emoji: { messageId: id, userId: me.id, emoji } },
      update: {},
      create: { messageId: id, userId: me.id, emoji },
    })
    await emitRealtimeToUsers(await reactionRecipients(message), 'message:reaction', {
      messageId: id,
      conversationId: message.conversationId ?? null,
      userId: me.id,
      emoji,
      op: 'add',
      action: 'added',
    })
    return json({ ok: true })
  } catch (error) {
    return handleRouteError(error, 'POST /api/messages/[id]/reactions')
  }
}

// DELETE remove a reaction
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const me = await getSessionUser()
    if (!me) throw new RouteError('UNAUTHORIZED')

    const { id } = await params
    const emoji = validateEmoji(req.nextUrl.searchParams.get('emoji'))

    const message = await loadMessageForParticipant(id, me.id)

    // Scoped to the caller's own reaction, so this cannot remove someone else's.
    await db.messageReaction.deleteMany({ where: { messageId: id, userId: me.id, emoji } })
    await emitRealtimeToUsers(await reactionRecipients(message), 'message:reaction', {
      messageId: id,
      conversationId: message.conversationId ?? null,
      userId: me.id,
      emoji,
      op: 'remove',
      action: 'removed',
    })
    return json({ ok: true })
  } catch (error) {
    return handleRouteError(error, 'DELETE /api/messages/[id]/reactions')
  }
}
