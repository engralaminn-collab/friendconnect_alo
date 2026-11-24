import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/session'
import { relationshipView } from '@/lib/friendship'
import { handleRouteError } from '@/lib/api-errors'
import { errorJson, json } from '@/lib/serialize'

/**
 * GET /api/users/[id]
 *
 * Public profile plus the viewer's relationship, using the shared state machine
 * so `relation` cannot disagree with `/api/friends`.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const me = await getCurrentUser()
    if (!me) return errorJson('Unauthorized', 401)
    const { id } = await params

    const user = await db.user.findUnique({ where: { id }, include: { profile: true } })
    if (!user) return errorJson('User not found', 404)

    const relation = await relationshipView(me.id, id)

    // PRIVATE profiles show only the basics to non-friends.
    const visibility = user.profile?.profileVisibility || 'PUBLIC'
    const canViewFull = visibility === 'PUBLIC' || relation.isFriend || id === me.id

    const profile = user.profile
    return json({
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        photoUrl: profile?.photoUrl ?? user.avatarUrl ?? null,
        photoFilter: profile?.photoFilter ?? null,
        verified: profile?.verified ?? 'unverified',
        bio: canViewFull ? profile?.bio ?? null : null,
        phone: canViewFull ? profile?.phone ?? null : null,
        location: canViewFull ? profile?.location ?? null : null,
        birthday: canViewFull ? profile?.birthday ?? null : null,
        education: canViewFull ? profile?.education ?? null : null,
        work: canViewFull ? profile?.work ?? null : null,
      },
      relation,
      canMessage:
        !relation.isBlocked &&
        (relation.isFriend ||
          profile?.messagePermission === 'EVERYONE' ||
          profile?.messagePermission === 'PUBLIC'),
      canCall:
        !relation.isBlocked &&
        (relation.isFriend ||
          profile?.callPermission === 'EVERYONE' ||
          profile?.callPermission === 'PUBLIC'),
    })
  } catch (error) {
    return handleRouteError(error, 'GET /api/users/[id]')
  }
}
