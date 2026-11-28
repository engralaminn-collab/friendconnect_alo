import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { errorJson, json } from '@/lib/serialize'
import { handleRouteError } from '@/lib/api-errors'
import { audit } from '@/lib/audit'
import { canInteract, canSendInConversation, isJaraId, normalizeMessageContent } from '@/lib/socket-security.cjs'

/** `Message.status` value for a scheduled message the sender cancelled. */
export const CANCELLED_STATUS = 'CANCELLED'

// GET my scheduled messages
export async function GET() {
  try {
    const me = await getSessionUser()
    if (!me) return errorJson('Unauthorized', 401)
    const scheduled = await db.message.findMany({
      // Finding 9: a cancelled message keeps its `scheduledFor` timestamp (that is
      // the audit trail), so the status filter is what keeps it out of the
      // "upcoming" list.
      where: { senderId: me.id, scheduledFor: { gt: new Date() }, status: 'SENT' },
      orderBy: { scheduledFor: 'asc' },
      include: {
        receiver: { select: { id: true, name: true, username: true } },
        group: { select: { id: true, name: true } },
      },
    })
    return json({
      scheduled: scheduled.map((m) => ({
        id: m.id,
        content: m.content,
        type: m.type,
        scheduledFor: m.scheduledFor!.toISOString(),
        receiverId: m.receiverId,
        receiverName: m.receiver?.name ?? null,
        groupId: m.groupId,
        groupName: m.group?.name ?? null,
      })),
    })
  } catch (error) {
    return handleRouteError(error, '/api/messages/scheduled')
  }
}

// POST create a scheduled message (does NOT send now — stored with scheduledFor in the future)
export async function POST(req: NextRequest) {
  try {
    const me = await getSessionUser()
    if (!me) return errorJson('Unauthorized', 401)
    const body = await req.json()
    // `.slice(0, 5000)` silently truncated longer bodies, so the sender had no
    // way to know their text was cut; 5000 also disagreed with the 10 000-character
    // policy every other send path uses (finding 6). Reject instead of truncate.
    const normalized = normalizeMessageContent(body.content)
    if (!normalized.ok) {
      return errorJson(normalized.error, normalized.error === 'Message too long' ? 413 : 400)
    }
    const content = normalized.content
    const scheduledFor = body.scheduledFor ? new Date(body.scheduledFor) : null
    const receiverId = body.receiverId ? String(body.receiverId) : null
    const groupId = body.groupId ? String(body.groupId) : null
    if (!scheduledFor || Number.isNaN(scheduledFor.getTime()) || scheduledFor.getTime() <= Date.now()) {
      return errorJson('scheduledFor must be a future date', 400)
    }
    if (!receiverId && !groupId) return errorJson('receiverId or groupId required', 400)

    // A scheduled message is a message: the same block and permission rules must
    // apply at scheduling time, or scheduling becomes a way around finding 1.
    if (receiverId && !isJaraId(receiverId)) {
      if (!(await canInteract(db, me.id, receiverId, 'messagePermission'))) {
        return errorJson('Not permitted to message this user', 403)
      }
    }
    if (groupId) {
      const membership = await db.groupMember.findUnique({
        where: { groupId_userId: { groupId, userId: me.id } },
      })
      if (!membership) return errorJson('Not a member', 403)
      const members = await db.groupMember.findMany({
        where: { groupId },
        select: { userId: true },
      })
      const check = await canSendInConversation(
        db,
        me.id,
        members.map((m: { userId: string }) => m.userId),
      )
      if (!check.allowed) return errorJson('Not permitted to message this group', 403)
    }

    const msg = await db.message.create({
      data: {
        senderId: me.id,
        receiverId: receiverId,
        groupId: groupId,
        content,
        type: 'text',
        status: 'SENT',
        scheduledFor,
      },
    })
    return json({ message: { id: msg.id, scheduledFor: msg.scheduledFor!.toISOString() } })
  } catch (error) {
    return handleRouteError(error, '/api/messages/scheduled')
  }
}

/**
 * Where a stored message stands, from the sender's point of view.
 *
 * `Message.status` carries delivery state (SENT/DELIVERED/SEEN), so cancellation
 * has its own value rather than a deletion. Finding 9: cancelling used to delete
 * the row outright, which destroyed the only record that the message had ever
 * been scheduled and made "cancelled" indistinguishable from "never existed".
 */
export function scheduledState(
  msg: { scheduledFor: Date | string | null; status?: string | null; deletedFor?: string | null },
  now = Date.now(),
): 'pending' | 'delivered' | 'cancelled' {
  if (msg.status === CANCELLED_STATUS) return 'cancelled'
  if (!msg.scheduledFor) return 'delivered'
  const due = new Date(msg.scheduledFor).getTime()
  return Number.isFinite(due) && due > now ? 'pending' : 'delivered'
}

// DELETE cancel a scheduled message.
//
// Cancellation is a status change, not a delete: the row is kept so the audit
// trail survives, and a cancelled message is excluded from delivery by
// `runJobs()` (it only sends rows whose status is still "SENT"). The update is
// conditional on the sender owning the row *and* the message still being
// cancellable, so it is a single atomic statement — two concurrent cancels, or a
// cancel racing the delivery job, cannot both succeed.
export async function DELETE(req: NextRequest) {
  try {
    const me = await getSessionUser()
    if (!me) return errorJson('Unauthorized', 401)
    const id = req.nextUrl.searchParams.get('id')
    if (!id) return errorJson('id required', 400)
    const msg = await db.message.findUnique({ where: { id } })
    // Same answer for "not mine" and "does not exist", so ids cannot be probed.
    if (!msg || msg.senderId !== me.id) return errorJson('Not found', 404)
    if (!msg.scheduledFor) return errorJson('Not a scheduled message', 400)

    const state = scheduledState(msg)
    if (state === 'cancelled') return json({ ok: true, status: 'cancelled', alreadyCancelled: true })
    if (state === 'delivered') {
      return errorJson('That message has already been delivered', 409, 'CONFLICT')
    }

    const result = await db.message.updateMany({
      where: { id, senderId: me.id, scheduledFor: { gt: new Date() }, status: 'SENT' },
      data: { status: CANCELLED_STATUS },
    })
    if (!result || result.count === 0) {
      // The delivery job won the race, or another request cancelled it first.
      const after = await db.message.findUnique({ where: { id }, select: { status: true, scheduledFor: true } })
      const afterState = after ? scheduledState(after) : 'delivered'
      if (afterState === 'cancelled') return json({ ok: true, status: 'cancelled', alreadyCancelled: true })
      return errorJson('That message is no longer cancellable', 409, 'CONFLICT')
    }
    await audit({ userId: me.id, action: 'scheduled_message_cancelled', resource: id })
    return json({ ok: true, status: 'cancelled' })
  } catch (error) {
    return handleRouteError(error, '/api/messages/scheduled')
  }
}
