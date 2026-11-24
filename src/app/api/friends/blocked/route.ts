import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/session'
import { handleRouteError } from '@/lib/api-errors'
import { json } from '@/lib/serialize'

/**
 * GET /api/friends/blocked
 *
 * Users this account has blocked. Reads the `Block` table — the authority for
 * block enforcement — rather than `Friendship.status`, so the list cannot
 * disagree with the messaging checks.
 */
export async function GET() {
  try {
    const me = await getCurrentUser()
    if (!me) return json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401)

    const blocks = await db.block.findMany({
      where: { fromId: me.id },
      orderBy: { createdAt: 'desc' },
    })

    const targetIds = blocks.map((b: { toId: string }) => b.toId)
    const users = targetIds.length
      ? await db.user.findMany({
          where: { id: { in: targetIds } },
          select: {
            id: true,
            username: true,
            name: true,
            avatarUrl: true,
            profile: { select: { photoUrl: true } },
          },
        })
      : []
    const userMap = new Map(users.map((user: any) => [user.id, user]))

    return json({
      blocked: blocks
        .map((block: any) => {
          const user = userMap.get(block.toId) as any
          if (!user) return null
          return {
            id: user.id,
            username: user.username,
            name: user.name,
            photoUrl: user.profile?.photoUrl ?? user.avatarUrl ?? null,
            blockedAt:
              block.createdAt instanceof Date ? block.createdAt.toISOString() : block.createdAt,
          }
        })
        .filter(Boolean),
    })
  } catch (error) {
    return handleRouteError(error, 'GET /api/friends/blocked')
  }
}
