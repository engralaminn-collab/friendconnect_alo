/**
 * Friendship state machine.
 *
 * Before this module, `POST /api/friends` wrote a `FriendRequest` row while
 * every read path (`/api/friends`, `/api/friends/requests`, chat, calls,
 * stories, presence) queried `Friendship`. Nothing ever promoted a request into
 * a friendship, and there was no accept or cancel endpoint at all, so two people
 * could never become friends — which silently disabled chat, calls, stories and
 * presence for the whole product.
 *
 * `Friendship` is now the single source of truth for the relationship, with the
 * request lifecycle modelled as its `status`:
 *
 *   (none) --request--> PENDING --accept--> ACCEPTED --remove--> (deleted)
 *                            |                    |
 *                            +--reject--> REJECTED|
 *                            +--cancel--> DELETED|
 *                                                +--block--> BLOCKED
 *
 * `FriendRequest` is kept as a compatibility view for older clients but is no
 * longer written.
 */

import { db } from '@/lib/db'

export type FriendshipStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'BLOCKED'
export type FriendAction =
  | 'request'
  | 'accept'
  | 'reject'
  | 'cancel'
  | 'remove'
  | 'unfriend'
  | 'unblock'
  | 'block'

export interface ActionResult {
  ok: true
  status: FriendshipStatus | 'NONE'
  /** True when the operation changed stored state. */
  changed: boolean
  friendshipId?: string
}

/** Thrown for client-caused failures; carries the HTTP status to return. */
export class FriendError extends Error {
  status: number
  code: string
  constructor(message: string, status = 400, code = 'FRIEND_ERROR') {
    super(message)
    this.name = 'FriendError'
    this.status = status
    this.code = code
  }
}

/**
 * Accepted friendship between two users, in either direction.
 * Returns the raw row so callers can inspect status.
 */
export async function findRelationship(userId: string, otherId: string) {
  return db.friendship.findFirst({
    where: {
      OR: [
        { requesterId: userId, receiverId: otherId },
        { requesterId: otherId, receiverId: userId },
      ],
    },
  })
}

/**
 * Is there an accepted friendship? This is the check chat/calls/stories use.
 * Blocked relationships never count as friendship.
 */
export async function areFriends(userId: string, otherId: string): Promise<boolean> {
  const relationship = await findRelationship(userId, otherId)
  return Boolean(relationship && relationship.status === 'ACCEPTED')
}

/** Either user has blocked the other. */
export async function isBlockedBetween(userId: string, otherId: string): Promise<boolean> {
  const block = await db.block.findFirst({
    where: {
      OR: [
        { fromId: userId, toId: otherId },
        { fromId: otherId, toId: userId },
      ],
    },
    select: { id: true },
  })
  if (block) return true
  const relationship = await findRelationship(userId, otherId)
  return Boolean(relationship && relationship.status === 'BLOCKED')
}

/** Everyone this user is accepted-friends with. */
export async function friendIds(userId: string): Promise<string[]> {
  const rows = await db.friendship.findMany({
    where: {
      status: 'ACCEPTED',
      OR: [{ requesterId: userId }, { receiverId: userId }],
    },
    select: { requesterId: true, receiverId: true },
  })
  return Array.from(
    new Set(rows.map((row: { requesterId: string; receiverId: string }) =>
      row.requesterId === userId ? row.receiverId : row.requesterId,
    )),
  )
}

function assertNotSelf(userId: string, otherId: string) {
  if (!otherId || typeof otherId !== 'string') {
    throw new FriendError('targetId required', 400, 'TARGET_REQUIRED')
  }
  if (userId === otherId) {
    throw new FriendError('You cannot add yourself', 400, 'SELF_TARGET')
  }
}

async function assertUserExists(otherId: string) {
  const target = await db.user.findUnique({ where: { id: otherId }, select: { id: true } })
  if (!target) throw new FriendError('User not found', 404, 'USER_NOT_FOUND')
}

/**
 * Apply a friend action on behalf of `userId` against `targetId`.
 *
 * Idempotent by design: repeating an action that has already taken effect
 * returns the current state with `changed: false` instead of failing. The UI
 * re-renders from server state immediately after every action, so a benign
 * double-click must not surface an error.
 */
export async function applyFriendAction(
  userId: string,
  targetId: string,
  action: FriendAction,
): Promise<ActionResult> {
  assertNotSelf(userId, targetId)
  await assertUserExists(targetId)

  const existing = await findRelationship(userId, targetId)

  switch (action) {
    case 'request': {
      if (existing) {
        if (existing.status === 'ACCEPTED') {
          return { ok: true, status: 'ACCEPTED', changed: false, friendshipId: existing.id }
        }
        if (existing.status === 'BLOCKED') {
          throw new FriendError('You cannot send a request to this user', 403, 'BLOCKED')
        }
        if (existing.status === 'PENDING') {
          // Reciprocal request: the other person already asked. Accept it, which
          // is what the user means by pressing "Add".
          if (existing.receiverId === userId) {
            const updated = await db.friendship.update({
              where: { id: existing.id },
              data: { status: 'ACCEPTED' },
            })
            await notifyAccepted(updated.requesterId, userId)
            return { ok: true, status: 'ACCEPTED', changed: true, friendshipId: existing.id }
          }
          return { ok: true, status: 'PENDING', changed: false, friendshipId: existing.id }
        }
        // REJECTED: allow a fresh request by flipping it back to PENDING.
        const revived = await db.friendship.update({
          where: { id: existing.id },
          data: { status: 'PENDING', requesterId: userId, receiverId: targetId },
        })
        return { ok: true, status: 'PENDING', changed: true, friendshipId: revived.id }
      }

      if (await isBlockedBetween(userId, targetId)) {
        throw new FriendError('You cannot send a request to this user', 403, 'BLOCKED')
      }

      const created = await db.friendship.create({
        data: { requesterId: userId, receiverId: targetId, status: 'PENDING' },
      })
      await notifyRequest(created.id, userId, targetId)
      return { ok: true, status: 'PENDING', changed: true, friendshipId: created.id }
    }

    case 'accept': {
      if (!existing) throw new FriendError('No pending request from this user', 404, 'NO_REQUEST')
      if (existing.status === 'ACCEPTED') {
        return { ok: true, status: 'ACCEPTED', changed: false, friendshipId: existing.id }
      }
      // Only the recipient may accept, and only a pending request.
      if (existing.receiverId !== userId) {
        throw new FriendError('Only the recipient can accept this request', 403, 'NOT_RECIPIENT')
      }
      if (existing.status !== 'PENDING') {
        throw new FriendError('That request is no longer pending', 409, 'NOT_PENDING')
      }
      const updated = await db.friendship.update({
        where: { id: existing.id },
        data: { status: 'ACCEPTED' },
      })
      await notifyAccepted(targetId, userId)
      return { ok: true, status: 'ACCEPTED', changed: true, friendshipId: existing.id }
    }

    case 'reject': {
      if (!existing || existing.status !== 'PENDING') {
        return { ok: true, status: 'NONE', changed: false }
      }
      if (existing.receiverId !== userId) {
        throw new FriendError('Only the recipient can decline this request', 403, 'NOT_RECIPIENT')
      }
      await db.friendship.update({ where: { id: existing.id }, data: { status: 'REJECTED' } })
      return { ok: true, status: 'REJECTED', changed: true, friendshipId: existing.id }
    }

    case 'cancel': {
      if (!existing || existing.status !== 'PENDING') {
        return { ok: true, status: 'NONE', changed: false }
      }
      if (existing.requesterId !== userId) {
        throw new FriendError('Only the sender can cancel this request', 403, 'NOT_SENDER')
      }
      // Cancelling is a withdrawal: drop the row so a new request is possible.
      await db.friendship.delete({ where: { id: existing.id } })
      return { ok: true, status: 'NONE', changed: true, friendshipId: existing.id }
    }

    case 'remove':
    case 'unfriend': {
      if (!existing) return { ok: true, status: 'NONE', changed: false }
      if (existing.status === 'BLOCKED') {
        throw new FriendError('Unblock this user first', 409, 'BLOCKED')
      }
      await db.friendship.delete({ where: { id: existing.id } })
      return { ok: true, status: 'NONE', changed: true, friendshipId: existing.id }
    }

    case 'block': {
      // `Block` is the authority for block enforcement; `Friendship.status` is
      // set too so profile/relationship renders agree without an extra query.
      const already = await db.block.findFirst({
        where: { fromId: userId, toId: targetId },
        select: { id: true },
      })
      if (!already) {
        await db.block.create({ data: { fromId: userId, toId: targetId } })
      }
      if (existing) {
        if (existing.status !== 'BLOCKED') {
          await db.friendship.update({
            where: { id: existing.id },
            data: { status: 'BLOCKED', blockerId: userId },
          })
        }
      } else {
        await db.friendship.create({
          data: { requesterId: userId, receiverId: targetId, status: 'BLOCKED', blockerId: userId },
        })
      }
      return { ok: true, status: 'BLOCKED', changed: !already }
    }

    case 'unblock': {
      await db.block.deleteMany({ where: { fromId: userId, toId: targetId } })
      if (existing && existing.status === 'BLOCKED') {
        // Revert to no relationship; a new request starts from scratch.
        await db.friendship.delete({ where: { id: existing.id } })
        return { ok: true, status: 'NONE', changed: true, friendshipId: existing.id }
      }
      return { ok: true, status: existing?.status ?? 'NONE', changed: false }
    }

    default:
      throw new FriendError(`Unknown action "${action}"`, 400, 'UNKNOWN_ACTION')
  }
}

/** Which actions the current user may take against `otherId` (for the UI). */
export async function relationshipView(userId: string, otherId: string) {
  const relationship = await findRelationship(userId, otherId)
  const blockedByMe = Boolean(
    await db.block.findFirst({ where: { fromId: userId, toId: otherId }, select: { id: true } }),
  )
  const blockedMe = Boolean(
    await db.block.findFirst({ where: { fromId: otherId, toId: userId }, select: { id: true } }),
  )

  const status = (relationship?.status ?? 'NONE') as FriendshipStatus | 'NONE'
  const isFriend = status === 'ACCEPTED' && !blockedByMe && !blockedMe
  const isBlocked = blockedByMe || blockedMe || status === 'BLOCKED'

  return {
    status,
    isFriend,
    isBlocked,
    blockedByMe,
    incomingRequest:
      status === 'PENDING' && relationship.receiverId === userId && !isBlocked,
    outgoingRequest:
      status === 'PENDING' && relationship.requesterId === userId && !isBlocked,
    canAccept: status === 'PENDING' && relationship.receiverId === userId && !isBlocked,
    canCancel: status === 'PENDING' && relationship.requesterId === userId && !isBlocked,
  }
}

async function notifyRequest(friendshipId: string, fromId: string, toId: string) {
  try {
    const from = await db.user.findUnique({ where: { id: fromId }, select: { name: true, username: true } })
    await db.notification.create({
      data: {
        userId: toId,
        type: 'friend_request',
        title: 'New friend request',
        body: `${from?.name ?? from?.username ?? 'Someone'} sent you a friend request`,
        data: JSON.stringify({ friendshipId, fromId }),
      },
    })
  } catch {
    // Notifications are best-effort; a failure must not undo the relationship.
  }
}

async function notifyAccepted(requesterId: string, accepterId: string) {
  try {
    const accepter = await db.user.findUnique({
      where: { id: accepterId },
      select: { name: true, username: true },
    })
    await db.notification.create({
      data: {
        userId: requesterId,
        type: 'friend_accepted',
        title: 'Friend request accepted',
        body: `${accepter?.name ?? accepter?.username ?? 'Someone'} accepted your friend request`,
        data: JSON.stringify({ accepterId }),
      },
    })
  } catch {
    // best-effort
  }
}
