import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/session'
import {
  applyFriendAction,
  FriendError,
  friendIds,
  type FriendAction,
} from '@/lib/friendship'
import { handleRouteError } from '@/lib/api-errors'
import { errorJson, json } from '@/lib/serialize'

/** Minimal shape the friend lists render. */
type PeerView = {
  id: string
  username: string
  name: string
  photoUrl: string | null
  [extra: string]: unknown
}

/**
 * GET /api/friends
 *
 * Returns `{ friends, sent, received }` — the shape both Sidebar.tsx and
 * FriendsView.tsx consume. `sent`/`received` come from `Friendship` rows in the
 * PENDING state, which is where requests now live.
 */
export async function GET() {
  try {
    const me = await getCurrentUser()
    if (!me) return errorJson('Unauthorized', 401)

    const [relationships, blocks, friends] = await Promise.all([
      db.friendship.findMany({
        where: { OR: [{ requesterId: me.id }, { receiverId: me.id }] },
        orderBy: { createdAt: 'desc' },
      }),
      db.block.findMany({
        where: { OR: [{ fromId: me.id }, { toId: me.id }] },
        select: { fromId: true, toId: true },
      }),
      friendIds(me.id),
    ])

    const blockedIds = new Set(
      blocks.map((b: { fromId: string; toId: string }) =>
        b.fromId === me.id ? b.toId : b.fromId,
      ),
    )

    // One query for every user we need to describe, instead of N+1.
    const peerIds = new Set<string>(friends)
    for (const rel of relationships) {
      if (rel.status === 'PENDING') {
        peerIds.add(rel.requesterId === me.id ? rel.receiverId : rel.requesterId)
      }
    }
    const peers = peerIds.size
      ? await db.user.findMany({
          where: { id: { in: Array.from(peerIds) } },
          select: {
            id: true,
            username: true,
            name: true,
            avatarUrl: true,
            status: true,
            lastSeenAt: true,
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
          avatarUrl: peer.avatarUrl ?? null,
          status: peer.status ?? '',
          lastSeenAt: peer.lastSeenAt instanceof Date ? peer.lastSeenAt.toISOString() : peer.lastSeenAt,
          online: false,
        },
      ]),
    )

    const friendList = friends
      .map((id) => peerMap.get(id))
      .filter(Boolean)

    const sent: any[] = []
    const received: any[] = []
    for (const rel of relationships) {
      if (rel.status !== 'PENDING') continue
      const outgoing = rel.requesterId === me.id
      const peerId = outgoing ? rel.receiverId : rel.requesterId
      if (blockedIds.has(peerId)) continue
      const peer = peerMap.get(peerId)
      if (!peer) continue
      const entry = {
        id: peer.id,
        friendshipId: rel.id,
        username: peer.username,
        name: peer.name,
        photoUrl: peer.photoUrl,
        createdAt: rel.createdAt instanceof Date ? rel.createdAt.toISOString() : rel.createdAt,
      }
      if (outgoing) sent.push(entry)
      else received.push(entry)
    }

    return json({ friends: friendList, sent, received })
  } catch (error) {
    return handleRouteError(error, 'GET /api/friends')
  }
}

/**
 * POST /api/friends
 *
 * Accepts the request contract the UI actually uses:
 *   { action, targetId }   (FriendsView.tsx, ProfileView.tsx, HomeView.tsx)
 *   { action, id }         (alias used by older callers)
 *   { toId }               (legacy: implicitly action=request)
 */
export async function POST(req: NextRequest) {
  try {
    const me = await getCurrentUser()
    if (!me) return errorJson('Unauthorized', 401)

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    if (!body || typeof body !== 'object') return errorJson('Invalid JSON body', 400)

    const targetId = String(body.targetId ?? body.id ?? body.toId ?? '').trim()
    if (!targetId) return errorJson('targetId required', 400)

    const rawAction = body.action ?? (body.toId && !body.action ? 'request' : undefined)
    const action = String(rawAction ?? 'request').trim().toLowerCase().replace(/^friend_/, '')
    const allowed: FriendAction[] = [
      'request',
      'accept',
      'reject',
      'cancel',
      'remove',
      'unfriend',
      'unblock',
      'block',
    ]
    if (!allowed.includes(action as FriendAction)) {
      return errorJson(`Unknown action "${action}"`, 400)
    }

    const result = await applyFriendAction(me.id, targetId, action as FriendAction)
    return json(result)
  } catch (error) {
    if (error instanceof FriendError) {
      return errorJson(error.message, error.status, error.code)
    }
    return handleRouteError(error, 'POST /api/friends')
  }
}
