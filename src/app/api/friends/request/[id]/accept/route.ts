import { NextRequest } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { applyFriendAction, FriendError } from '@/lib/friendship'
import { handleRouteError } from '@/lib/api-errors'
import { errorJson, json } from '@/lib/serialize'

/**
 * POST /api/friends/request/[id]/accept
 *
 * `id` is the other user's id — that is what `/api/friends/requests` returns as
 * each incoming request's `id`, and what the UI posts back. Accepting also
 * tolerates `id` being a Friendship row id, for callers that have one.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const me = await getCurrentUser()
    if (!me) return errorJson('Unauthorized', 401)

    const { id } = await params
    if (!id) return errorJson('Request id required', 400)

    const targetId = await resolvePeerId(id, me.id)
    if (!targetId) return errorJson('Request not found', 404)

    const result = await applyFriendAction(me.id, targetId, 'accept')
    return json(result)
  } catch (error) {
    if (error instanceof FriendError) return errorJson(error.message, error.status, error.code)
    return handleRouteError(error, 'POST /api/friends/request/[id]/accept')
  }
}

/**
 * Resolve the other party from either a user id (normal case) or a
 * Friendship id, so both callers work without guessing.
 */
async function resolvePeerId(identifier: string, userId: string): Promise<string | null> {
  const { db } = await import('@/lib/db')

  const byFriendship = await db.friendship.findUnique({ where: { id: identifier } })
  if (byFriendship && byFriendship.status === 'PENDING') {
    if (byFriendship.receiverId === userId) return byFriendship.requesterId
    if (byFriendship.requesterId === userId) return byFriendship.receiverId
    return null
  }

  const pending = await db.friendship.findFirst({
    where: { requesterId: identifier, receiverId: userId, status: 'PENDING' },
    select: { requesterId: true },
  })
  if (pending) return pending.requesterId

  // The viewer's own outgoing request: resolve it so `applyFriendAction` can
  // answer 403 "only the recipient can accept" instead of a misleading 404.
  // This only ever inspects the caller's own rows, so it reveals nothing.
  const ownOutgoing = await db.friendship.findFirst({
    where: { requesterId: userId, receiverId: identifier, status: 'PENDING' },
    select: { receiverId: true },
  })
  if (ownOutgoing) return ownOutgoing.receiverId

  // Idempotency: already accepted is a success, not a 404.
  const accepted = await db.friendship.findFirst({
    where: {
      status: 'ACCEPTED',
      OR: [
        { requesterId: identifier, receiverId: userId },
        { requesterId: userId, receiverId: identifier },
      ],
    },
    select: { requesterId: true, receiverId: true },
  })
  if (accepted) return accepted.requesterId === userId ? accepted.receiverId : accepted.requesterId

  return null
}
