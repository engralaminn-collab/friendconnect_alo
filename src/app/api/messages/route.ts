import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { errorJson, json } from '@/lib/serialize'
import { filterMessagesVisibleToUser } from '@/lib/ai-input'
import { canInteract, isJaraId, normalizeMessageContent } from '@/lib/socket-security.cjs'
import { grantMessageFileAccess } from '@/lib/file-access'
import { emitRealtimeToUsers } from '@/lib/realtime-emit'
import { scheduleJaraReply } from '@/lib/jara-responder'
import { handleRouteError } from '@/lib/api-errors'

/**
 * Recipients who should receive `message:new` for a stored message.
 *
 * A group message goes to every current member; a direct message goes to both
 * participants. Shared by the emit below so the REST fallback delivers exactly
 * what the socket path delivers.
 */
async function messageAudience(msg: {
  senderId: string
  receiverId: string | null
  groupId: string | null
}): Promise<string[]> {
  if (msg.groupId) {
    const members = await db.groupMember.findMany({
      where: { groupId: msg.groupId },
      select: { userId: true },
    })
    return [msg.senderId, ...members.map((m: { userId: string }) => m.userId)]
  }
  return [msg.senderId, msg.receiverId].filter((id): id is string => typeof id === 'string' && !!id)
}

/** Reject an attachment URL the caller does not own (finding #3). */
async function assertOwnsAttachment(userId: string, fileUrl: unknown) {
  if (!fileUrl) return null
  const url = String(fileUrl)
  const owned = await db.file.findFirst({ where: { url, ownerId: userId }, select: { id: true } })
  if (!owned) return 'Attachment is not owned by the sender'
  return null
}

export async function GET(req: NextRequest) {
  try {
    const me = await getSessionUser()
    if (!me) return errorJson('Unauthorized', 401)
    const userId = req.nextUrl.searchParams.get('userId')
    const groupId = req.nextUrl.searchParams.get('groupId')
    const before = req.nextUrl.searchParams.get('before')

    if (groupId) {
      const membership = await db.groupMember.findUnique({
        where: { groupId_userId: { groupId, userId: me.id } },
      })
      if (!membership) return errorJson('Not a member', 403)
      const q = req.nextUrl.searchParams.get('q')
      const now = new Date()
      const messages = await db.message.findMany({
        where: {
          groupId,
          // hide expired disappearing messages
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          ...(before ? { createdAt: { lt: new Date(before) } } : {}),
          ...(q ? { content: { contains: q } } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: q ? 100 : 50,
        include: {
          sender: { include: { profile: true } },
          reactions: { include: { user: { select: { id: true, name: true } } } },
          stars: { where: { userId: me.id }, select: { userId: true } },
        },
      })
      return json({
        messages: filterMessagesVisibleToUser<any>(messages, me.id).reverse().map((m) => ({
          id: m.id,
          senderId: m.senderId,
          senderName: m.sender.name,
          senderPhoto: m.sender.profile?.photoUrl ?? null,
          content: m.content,
          type: m.type,
          fileUrl: m.fileUrl,
          fileName: m.fileName,
          fileSize: m.fileSize,
          mimeType: m.mimeType,
          createdAt: m.createdAt.toISOString(),
          deletedFor: m.deletedFor,
          forwardedFrom: m.forwardedFrom,
          edited: m.edited,
          editedAt: m.editedAt?.toISOString() ?? null,
          pinnedBy: m.pinnedBy,
          replyToId: m.replyToId,
          expiresAt: m.expiresAt?.toISOString() ?? null,
          starred: (m.stars?.length ?? 0) > 0,
          reactions: m.reactions.map((r) => ({ emoji: r.emoji, userId: r.user.id, userName: r.user.name })),
        })),
      })
    }

    if (!userId) return errorJson('userId or groupId required', 400)
    // Finding #3: this used to look for Friendship.status === 'BLOCKED', which
    // the old request-only flow never wrote, so a block did not stop anyone from
    // reading the thread. `canInteract` reads the Block table and also refuses a
    // stale BLOCKED friendship row.
    const isJara = isJaraId(userId)
    if (!isJara && !(await canInteract(db, me.id, userId, 'messagePermission'))) {
      // Reading an existing thread is allowed for friends even when the
      // recipient has since tightened their message permission: only *new*
      // messages are gated by that. A block, however, hides the thread.
      const blocked = await db.block.findFirst({
        where: {
          OR: [
            { fromId: me.id, toId: userId },
            { fromId: userId, toId: me.id },
          ],
        },
        select: { id: true },
      })
      if (blocked) return errorJson('Cannot view messages', 403)
    }

    const q = req.nextUrl.searchParams.get('q')
    const now = new Date()
    // A direct conversation stores its messages with `conversationId` (the field
    // the chat view renders from), so filtering on sender/receiver alone hides them
    // from this endpoint. The thread is the direct conversation shared by the two
    // users — it must contain *both* as members. `members: { some: ... }` twice
    // reads as two separate membership rows, which is correct, but it also matches
    // a group-style conversation that happens to contain both; requiring
    // `type: 'direct'` and an exactly-two-member set keeps a third party's thread
    // from leaking in (an earlier version of this fix omitted the `me.id` check and
    // let an unrelated user read the thread).
    const sharedDirectConversations = await db.conversation.findMany({
      where: {
        type: 'direct',
        AND: [
          { members: { some: { userId: me.id } } },
          { members: { some: { userId } } },
        ],
      },
      select: { id: true, members: { select: { userId: true } } },
    })
    const directConversationIds = sharedDirectConversations
      .filter((conversation: { members: Array<{ userId: string }> }) => conversation.members.length === 2)
      .map((conversation: { id: string }) => conversation.id)
    const messages = await db.message.findMany({
      where: {
        groupId: null,
        // A blocked pair is refused above, so both shapes are safe to include.
        OR: [
          { senderId: me.id, receiverId: userId },
          { senderId: userId, receiverId: me.id },
          ...(directConversationIds.length ? [{ conversationId: { in: directConversationIds } }] : []),
        ],
        ...(before ? { createdAt: { lt: new Date(before) } } : {}),
        ...(q ? { content: { contains: q } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: q ? 100 : 50,
      include: {
        reactions: { include: { user: { select: { id: true, name: true } } } },
        stars: { where: { userId: me.id }, select: { userId: true } },
      },
    })
    // filter out expired disappearing messages + not-yet-due scheduled messages in JS
    const filtered = filterMessagesVisibleToUser<any>(messages, me.id)
      .filter((m) => (!m.expiresAt || m.expiresAt > now) && (!m.scheduledFor || m.scheduledFor <= now))
    // Mark incoming as seen (only when not searching), and only if this user has
    // read receipts enabled. Finding 8: the socket path already honoured
    // `Profile.readReceipts`, but this REST path marked every thread SEEN
    // unconditionally, so a user who turned receipts off still sent "seen" to
    // their peers the moment they opened the thread over REST.
    if (!q) {
      const profile = await db.profile
        .findUnique({ where: { userId: me.id }, select: { readReceipts: true } })
        .catch(() => null)
      if (profile?.readReceipts !== false) {
        await db.message.updateMany({
          where: { senderId: userId, receiverId: me.id, status: { not: 'SEEN' } },
          data: { status: 'SEEN', seenAt: new Date() },
        })
      }
    }
    return json({
      messages: filtered.reverse().map((m) => ({
        id: m.id,
        senderId: m.senderId,
        receiverId: m.receiverId,
        content: m.content,
        type: m.type,
        fileUrl: m.fileUrl,
        fileName: m.fileName,
        fileSize: m.fileSize,
        mimeType: m.mimeType,
        status: m.status,
        createdAt: m.createdAt.toISOString(),
        deletedFor: m.deletedFor,
        forwardedFrom: m.forwardedFrom,
        edited: m.edited,
        editedAt: m.editedAt?.toISOString() ?? null,
        pinnedBy: m.pinnedBy,
        replyToId: m.replyToId,
        expiresAt: m.expiresAt?.toISOString() ?? null,
        starred: (m.stars?.length ?? 0) > 0,
        reactions: m.reactions.map((r) => ({ emoji: r.emoji, userId: r.user.id, userName: r.user.name })),
      })),
    })
  } catch (error) {
    return handleRouteError(error, 'GET /api/messages')
  }
}

export async function POST(req: NextRequest) {
  try {
    const me = await getSessionUser()
    if (!me) return errorJson('Unauthorized', 401)
    const body = await req.json()
    const receiverId = body.receiverId ? String(body.receiverId) : null
    const groupId = body.groupId ? String(body.groupId) : null
    if (!receiverId && !groupId) return errorJson('receiverId or groupId required', 400)
    if (groupId) {
      const membership = await db.groupMember.findUnique({
        where: { groupId_userId: { groupId, userId: me.id } },
      })
      if (!membership) return errorJson('Not a member', 403)
    }
    if (receiverId) {
      // Block + messagePermission, identical to the socket path (finding #3).
      const isJara = isJaraId(receiverId)
      if (!isJara && !(await canInteract(db, me.id, receiverId, 'messagePermission'))) {
        return errorJson('Not permitted to message this user', 403)
      }
    }

    // Finding 6: the same 10 000-character policy the socket and conversation
    // routes already enforced. Without it a single request could store a
    // multi-megabyte row that broke list responses and the AI context builder.
    // An attachment-only message has no text and is still valid.
    const normalized = normalizeMessageContent(body.content ?? body.message ?? '')
    const content = normalized.ok ? normalized.content : ''
    if (!normalized.ok && !body.fileUrl) {
      const status = normalized.error === 'Message too long' ? 413 : 400
      return errorJson(normalized.error, status, 'VALIDATION_FAILED')
    }

    // Attachments must belong to the sender, or a caller could attach any
    // private file URL it guesses/knows to a message it sends.
    const attachmentError = await assertOwnsAttachment(me.id, body.fileUrl)
    if (attachmentError) return errorJson(attachmentError, 403)

    const msg = await db.message.create({
      data: {
        senderId: me.id,
        receiverId,
        groupId,
        content,
        type: body.type || 'text',
        fileUrl: body.fileUrl || null,
        fileName: body.fileName || null,
        fileSize: body.fileSize || null,
        mimeType: body.mimeType || null,
        replyToId: body.replyToId || null,
        status: 'SENT',
      },
    })
    // Finding #10: participants get an indexed download grant instead of the
    // download endpoint scanning Message for a matching fileUrl.
    await grantMessageFileAccess(msg)

    // Finding 5: this route stores without emitting, so the REST fallback the
    // chat UI uses when the socket is down delivered nothing until the recipient
    // reloaded. Emitting to the same audience the socket path uses closes that
    // gap; `emitRealtimeToUsers` is best-effort and never fails the request.
    await emitRealtimeToUsers(await messageAudience(msg), 'message:new', {
      id: msg.id,
      senderId: msg.senderId,
      receiverId: msg.receiverId,
      groupId: msg.groupId,
      content: msg.content,
      type: msg.type,
      fileUrl: msg.fileUrl,
      fileName: msg.fileName,
      fileSize: msg.fileSize,
      mimeType: msg.mimeType,
      replyToId: msg.replyToId,
      status: msg.status,
      createdAt: msg.createdAt instanceof Date ? msg.createdAt.toISOString() : msg.createdAt,
    })

    // Jara is a user, not a chatbot page: a message addressed to it is answered
    // through this same store by the AI gateway, and the reply reaches the sender
    // over Socket.IO. Scheduled rather than awaited so the send is never blocked
    // by provider latency.
    if (receiverId && isJaraId(receiverId)) {
      scheduleJaraReply(msg.id)
    }

    return json({
      message: {
        id: msg.id,
        senderId: msg.senderId,
        receiverId: msg.receiverId,
        groupId: msg.groupId,
        content: msg.content,
        type: msg.type,
        fileUrl: msg.fileUrl,
        fileName: msg.fileName,
        fileSize: msg.fileSize,
        mimeType: msg.mimeType,
        replyToId: msg.replyToId,
        status: msg.status,
        createdAt: msg.createdAt.toISOString(),
      },
    })
  } catch (error) {
    return handleRouteError(error, 'POST /api/messages')
  }
}
