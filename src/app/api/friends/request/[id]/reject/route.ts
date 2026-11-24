import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/session'
import { applyFriendAction, FriendError } from '@/lib/friendship'
import { handleRouteError } from '@/lib/api-errors'
import { errorJson, json } from '@/lib/serialize'

/**
 * POST /api/friends/request/[id]/reject
 *
 * Decline an incoming request. `id` is the requester's user id, or a
 * Friendship id.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const me = await getCurrentUser()
    if (!me) return errorJson('Unauthorized', 401)

    const { id } = await params
    if (!id) return errorJson('Request id required', 400)

    const byFriendship = await db.friendship.findUnique({ where: { id } })
    const targetId =
      byFriendship && byFriendship.receiverId === me.id
        ? byFriendship.requesterId
        : (
            await db.friendship.findFirst({
              where: { requesterId: id, receiverId: me.id, status: 'PENDING' },
              select: { requesterId: true },
            })
          )?.requesterId

    if (!targetId) {
      // Nothing pending from this user: already rejected or withdrawn.
      return json({ ok: true, status: 'NONE', changed: false })
    }

    // `applyFriendAction` enforces that only the recipient may reject.
    const result = await applyFriendAction(me.id, targetId, 'reject')
    return json(result)
  } catch (error) {
    if (error instanceof FriendError) return errorJson(error.message, error.status, error.code)
    return handleRouteError(error, 'POST /api/friends/request/[id]/reject')
  }
}
