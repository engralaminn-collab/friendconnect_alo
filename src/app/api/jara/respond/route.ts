import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { db } from '@/lib/db'
import { replyAsJaraForMessage } from '@/lib/jara-responder'
import { JARA_ID } from '@/lib/jara'

/**
 * Internal trigger: "this message was just stored, let Jara answer it".
 *
 * The realtime server owns `message:send` for clients that send over Socket.IO,
 * but it has no access to the AI gateway (a TypeScript module bundled into the
 * Next app), so it asks the app to produce the answer. This route is not part of
 * the public API: it authenticates with the same `x-internal-secret` the realtime
 * server already uses for `/internal/emit`, and it does not accept a caller
 * identity — the only thing it can do is ask Jara to answer a message Jara is
 * already an authorized participant of.
 */

function resolveInternalSecret(): string {
  return (
    process.env.SOCKET_INTERNAL_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    (process.env.NODE_ENV !== 'production' ? 'friendconnect-dev-secret-change-in-production' : '')
  )
}

function authorized(provided: string | null): boolean {
  const expected = resolveInternalSecret()
  if (!expected || !provided) return false
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(provided, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export async function POST(req: NextRequest) {
  if (!authorized(req.headers.get('x-internal-secret'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { messageId?: unknown; conversationId?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const messageId = typeof body.messageId === 'string' ? body.messageId : ''
  if (!messageId) return NextResponse.json({ error: 'messageId required' }, { status: 400 })

  // Defense in depth: the caller supplies an id, so re-check that the row exists,
  // that Jara is a member of its conversation, and that it was not sent by Jara.
  const message = await db.message
    .findUnique({
      where: { id: messageId },
      select: { id: true, senderId: true, receiverId: true, conversationId: true, groupId: true },
    })
    .catch(() => null)
  if (!message) return NextResponse.json({ error: 'Message not found' }, { status: 404 })
  if (message.senderId === JARA_ID) return NextResponse.json({ replied: false, reason: 'not_addressed' })

  if (typeof body.conversationId === 'string' && body.conversationId && body.conversationId !== message.conversationId) {
    return NextResponse.json({ error: 'Conversation mismatch' }, { status: 409 })
  }

  const outcome = await replyAsJaraForMessage(message.id)
  return NextResponse.json(outcome)
}
