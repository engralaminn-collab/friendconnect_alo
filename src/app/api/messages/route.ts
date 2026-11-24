import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { errorJson, json } from '@/lib/serialize'
import { filterMessagesVisibleToUser } from '@/lib/ai-input'
import { canInteract, isJaraId } from '@/lib/socket-security.cjs'
import { grantMessageFileAccess } from '@/lib/file-access'
import { handleRouteError } from '@/lib/api-errors'

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
    // mark incoming as seen (only when not searching)
    if (!q) {
      await db.message.updateMany({
        where: { senderId: userId, receiverId: me.id, status: { not: 'SEEN' } },
        data: { status: 'SEEN', seenAt: new Date() },
      })
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
    const content = String(body.content || body.message || '')
    if (!receiverId && !groupId) return errorJson('receiverId or groupId required', 400)
    if (!content && !body.fileUrl) return errorJson('content required', 400)
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
