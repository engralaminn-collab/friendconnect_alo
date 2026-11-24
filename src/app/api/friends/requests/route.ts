import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/session'
import { handleRouteError } from '@/lib/api-errors'
import { json } from '@/lib/serialize'

/** Minimal shape the friend lists render. */
type PeerView = {
  id: string
  username: string
  name: string
  photoUrl: string | null
  [extra: string]: unknown
}

/**
 * GET /api/friends/requests
 *
 * Pending requests in both directions. `id` is the *other user's* id, matching
 * what `POST /api/friends` and the accept/cancel endpoints accept, and what
 * FriendsView passes to `openProfile()`.
 */
export async function GET() {
  try {
    const me = await getCurrentUser()
    if (!me) return json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401)

    const [incomingRows, outgoingRows] = await Promise.all([
      db.friendship.findMany({
        where: { receiverId: me.id, status: 'PENDING' },
        orderBy: { createdAt: 'desc' },
      }),
      db.friendship.findMany({
        where: { requesterId: me.id, status: 'PENDING' },
        orderBy: { createdAt: 'desc' },
      }),
    ])

    // Blocks hide requests in both directions, so fetch the block set once.
    const blocks = await db.block.findMany({
      where: { OR: [{ fromId: me.id }, { toId: me.id }] },
      select: { fromId: true, toId: true },
    })
    const blockedIds = new Set(
      blocks.map((b: { fromId: string; toId: string }) =>
        b.fromId === me.id ? b.toId : b.fromId,
      ),
    )

    const peerIds = new Set<string>()
    for (const row of incomingRows) peerIds.add(row.requesterId)
    for (const row of outgoingRows) peerIds.add(row.receiverId)

    const peers = peerIds.size
      ? await db.user.findMany({
          where: { id: { in: Array.from(peerIds) } },
          select: {
            id: true,
            username: true,
            name: true,
            avatarUrl: true,
            profile: { select: { photoUrl: true } },
          },
        })
      : []
    const peerMap = new Map<string, PeerView>(
      peers.map((peer: any) => [
        peer.id,
        {
          id: peer.id,
          username: peer.username,
          name: peer.name,
          photoUrl: peer.profile?.photoUrl ?? peer.avatarUrl ?? null,
        },
      ]),
    )

    const shape = (row: any, peerId: string) => {
      const peer = peerMap.get(peerId)
      if (!peer || blockedIds.has(peerId)) return null
      return {
        id: peer.id,
        friendshipId: row.id,
        username: peer.username,
        name: peer.name,
        photoUrl: peer.photoUrl,
        createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
      }
    }

    return json({
      incoming: incomingRows.map((row: any) => shape(row, row.requesterId)).filter(Boolean),
      outgoing: outgoingRows.map((row: any) => shape(row, row.receiverId)).filter(Boolean),
    })
  } catch (error) {
    return handleRouteError(error, 'GET /api/friends/requests')
  }
}
