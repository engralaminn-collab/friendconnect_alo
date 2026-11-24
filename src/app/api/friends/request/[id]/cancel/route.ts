import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/session'
import { applyFriendAction, FriendError } from '@/lib/friendship'
import { handleRouteError } from '@/lib/api-errors'
import { errorJson, json } from '@/lib/serialize'

/**
 * POST /api/friends/request/[id]/cancel
 *
 * Withdraw a request this user sent. `id` is the recipient's user id (what
 * `/api/friends/requests` returns), or a Friendship id.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const me = await getCurrentUser()
    if (!me) return errorJson('Unauthorized', 401)

    const { id } = await params
    if (!id) return errorJson('Request id required', 400)

    const targetId = await resolvePeerId(id, me.id)
    if (!targetId) {
      // No pending request to withdraw — already cancelled, or never sent.
      // Cancelling is idempotent so the UI's retry/backoff cannot 404.
      return json({ ok: true, status: 'NONE', changed: false })
    }

    const result = await applyFriendAction(me.id, targetId, 'cancel')
    return json(result)
  } catch (error) {
    if (error instanceof FriendError) return errorJson(error.message, error.status, error.code)
    return handleRouteError(error, 'POST /api/friends/request/[id]/cancel')
  }
}

async function resolvePeerId(identifier: string, userId: string): Promise<string | null> {
  const byFriendship = await db.friendship.findUnique({ where: { id: identifier } })
  if (byFriendship && byFriendship.requesterId === userId) return byFriendship.receiverId

  const pending = await db.friendship.findFirst({
    where: { requesterId: userId, receiverId: identifier, status: 'PENDING' },
    select: { receiverId: true },
  })
  return pending?.receiverId ?? null
}
