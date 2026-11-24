import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { errorJson, json } from '@/lib/serialize'
import { filterMessagesVisibleToUser } from '@/lib/ai-input'

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
          starredBy: { where: { userId: me.id }, select: { userId: true } },
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
          starred: m.starredBy.length > 0,
          reactions: m.reactions.map((r) => ({ emoji: r.emoji, userId: r.user.id, userName: r.user.name })),
        })),
      })
    }

    if (!userId) return errorJson('userId or groupId required', 400)
    // ensure not blocked (skip for Jara — Jara is always accessible)
    const isJara = userId === 'jara-ai-system-001' || userId === 'jara'
    const blocked = !isJara ? await db.friendship.findFirst({
      where: {
        status: 'BLOCKED',
        OR: [
          { requesterId: me.id, receiverId: userId },
          { requesterId: userId, receiverId: me.id },
        ],
      },
    }) : null
    if (blocked) return errorJson('Cannot view messages', 403)

    const q = req.nextUrl.searchParams.get('q')
    const now = new Date()
    const messages = await db.message.findMany({
      where: {
        groupId: null,
        OR: [
          { senderId: me.id, receiverId: userId },
          { senderId: userId, receiverId: me.id },
        ],
        ...(before ? { createdAt: { lt: new Date(before) } } : {}),
        ...(q ? { content: { contains: q } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: q ? 100 : 50,
      include: {
        reactions: { include: { user: { select: { id: true, name: true } } } },
        starredBy: { where: { userId: me.id }, select: { userId: true } },
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
        starred: m.starredBy.length > 0,
        reactions: m.reactions.map((r) => ({ emoji: r.emoji, userId: r.user.id, userName: r.user.name })),
      })),
    })
  } catch (e: any) {
    return errorJson(e?.message || 'Server error', 500)
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
      const isJara = receiverId === 'jara-ai-system-001' || receiverId === 'jara'
      const blocked = !isJara ? await db.friendship.findFirst({
        where: {
          status: 'BLOCKED',
          OR: [
            { requesterId: me.id, receiverId },
            { requesterId: receiverId, receiverId: me.id },
          ],
        },
      }) : null
      if (blocked) return errorJson('Blocked', 403)
    }
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
  } catch (e: unknown) {
    const err = e as Error
    return errorJson(err?.message || 'Server error', 500)
  }
}
