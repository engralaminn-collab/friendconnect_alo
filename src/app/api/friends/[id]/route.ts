import { NextRequest } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { applyFriendAction, FriendError } from '@/lib/friendship'
import { handleRouteError } from '@/lib/api-errors'
import { errorJson, json } from '@/lib/serialize'

/**
 * DELETE /api/friends/[id]
 *
 * Remove a friendship. `id` is the other user's id.
 */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const me = await getCurrentUser()
    if (!me) return errorJson('Unauthorized', 401)
    const { id } = await params
    if (!id) return errorJson('Friend id required', 400)

    const result = await applyFriendAction(me.id, id, 'remove')
    return json(result)
  } catch (error) {
    if (error instanceof FriendError) return errorJson(error.message, error.status, error.code)
    return handleRouteError(error, 'DELETE /api/friends/[id]')
  }
}
