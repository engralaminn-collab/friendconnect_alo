import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/session"
import { db } from "@/lib/db"
import { filterMessagesVisibleToUser } from "@/lib/ai-input"
import { grantMessageFileAccess } from "@/lib/file-access"
import { emitRealtimeToUsers } from "@/lib/realtime-emit"
import { scheduleJaraReply } from "@/lib/jara-responder"
import { canReadConversation, canSendInConversation, normalizeMessageContent, MAX_MESSAGE_LENGTH } from "@/lib/socket-security.cjs"
import { JARA_ID } from "@/lib/jara"

/** Member ids of a conversation, in one query. Used by every check below. */
async function memberIds(conversationId: string): Promise<string[]> {
  const members = await db.conversationMember.findMany({
    where: { conversationId },
    select: { userId: true },
  })
  return members.map((m: { userId: string }) => m.userId)
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const conversationId = (await params).id
  const membership = await db.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId: me.id } },
  })
  if (!membership) return NextResponse.json({ error: "Not a member" }, { status: 403 })
  // A block hides the thread from the blocked party (audit finding 1). History
  // stays in the database; it just stops being readable by that member.
  const read = await canReadConversation(db, me.id, await memberIds(conversationId))
  if (!read.allowed) return NextResponse.json({ error: "Not a member" }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const cursor = searchParams.get("cursor")
  const limit = Math.min(Math.max(Number(searchParams.get("limit") || 50) || 50, 1), 100)

  // Visibility filtering has to happen before pagination, not after: the old
  // version fetched `limit` rows, dropped the ones deleted for this user, and
  // then reported `nextCursor` only when the *filtered* length equalled `limit`.
  // A page containing any message deleted for me therefore ended the thread and
  // hid older history. Solving one extra row tells us whether another page exists
  // without guessing from the filtered count.
  const pageSize = limit + 1
  const page = await db.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
    take: pageSize,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    include: {
      sender: { select: { id: true, username: true, name: true, avatarUrl: true } },
      attachments: true,
      reactions: { include: { user: { select: { id: true, username: true } } } },
      replyTo: { select: { id: true, content: true, senderId: true, sender: { select: { username: true, name: true } } } },
    },
  })
  // The cursor must come from the raw page, not from the filtered one: the next
  // query resumes from the last row actually returned by the database.
  const lastRaw = page.length > limit ? page[limit - 1] : null
  const visible = filterMessagesVisibleToUser<any>(page.slice(0, limit), me.id).reverse()
  return NextResponse.json({
    messages: visible,
    // Pagination cursor for the next (older) page, or null at the end.
    nextCursor: lastRaw ? lastRaw.id : null,
  })
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const conversationId = (await params).id
  const membership = await db.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId: me.id } },
  })
  if (!membership) return NextResponse.json({ error: "Not a member" }, { status: 403 })

  const member = await memberIds(conversationId)
  // Findings 1 + 6: the same authorization and length policy the socket path
  // uses. A member row survives a block, so membership alone is not permission.
  const send = await canSendInConversation(db, me.id, member)
  if (!send.allowed) {
    return NextResponse.json({ error: "You cannot send messages in this conversation" }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const { content, replyToId, attachmentIds }: { content?: unknown; replyToId?: unknown; attachmentIds?: unknown } = body
  const cleanAttachmentIds = Array.isArray(attachmentIds)
    ? Array.from(new Set(attachmentIds.filter((v): v is string => typeof v === "string" && v.length > 0)))
    : []
  const normalized = normalizeMessageContent(content ?? "")
  // An attachment-only message is valid; text messages are not.
  const contentText = normalized.ok ? normalized.content : ""
  if (!contentText && cleanAttachmentIds.length === 0) {
    const status = !normalized.ok && normalized.error === "Message too long" ? 413 : 400
    return NextResponse.json({ error: normalized.ok ? "Empty message" : normalized.error, maxLength: MAX_MESSAGE_LENGTH }, { status })
  }

  let ownedAttachments: Array<{ id: string; url: string; filename: string; mimeType: string; size: number }> = []
  if (cleanAttachmentIds.length > 0) {
    ownedAttachments = await db.attachment.findMany({
      where: { id: { in: cleanAttachmentIds }, ownerId: me.id },
      select: { id: true, url: true, filename: true, mimeType: true, size: true },
    })
    if (ownedAttachments.length !== cleanAttachmentIds.length) {
      return NextResponse.json({ error: "Attachment not found or not owned by sender" }, { status: 403 })
    }
  }

  const peers = member.filter((uid) => uid !== me.id)
  const firstAtt = ownedAttachments[0]

  const msg = await db.message.create({
    data: {
      conversationId,
      senderId: me.id,
      receiverId: peers.length === 1 ? peers[0] : null,
      content: contentText,
      type: firstAtt
        ? firstAtt.mimeType.startsWith("image/")
          ? "image"
          : firstAtt.mimeType.startsWith("audio/")
            ? "audio"
            : firstAtt.mimeType.startsWith("video/")
              ? "video"
              : "file"
        : "text",
      fileUrl: firstAtt?.url ?? null,
      fileName: firstAtt?.filename ?? null,
      fileSize: firstAtt?.size ?? null,
      mimeType: firstAtt?.mimeType ?? null,
      replyToId: typeof replyToId === "string" && replyToId ? replyToId : null,
      ...(cleanAttachmentIds.length
        ? { attachments: { connect: cleanAttachmentIds.map((id) => ({ id })) } }
        : {}),
    },
    include: {
      sender: { select: { id: true, username: true, name: true, avatarUrl: true } },
      attachments: true,
      reactions: { include: { user: { select: { id: true, username: true } } } },
    },
  })

  if (ownedAttachments.length > 0 || msg.fileUrl) {
    await grantMessageFileAccess({
      id: msg.id,
      senderId: me.id,
      receiverId: msg.receiverId,
      conversationId,
      fileUrl: msg.fileUrl,
      attachments: msg.attachments?.length ? msg.attachments : ownedAttachments,
    })
  }

  await emitRealtimeToUsers(
    member,
    "message:new",
    msg,
  )

  // This is the path the chat UI sends on. When Jara is one of the members its
  // answer is stored in this same conversation, so it renders, paginates and
  // notifies like any other message instead of living in a separate chatbot.
  if (member.some((id) => id === JARA_ID)) {
    scheduleJaraReply(msg.id)
  }

  return NextResponse.json({ message: msg }, { status: 201 })
}

// Mark conversation as read
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const conversationId = (await params).id
  const membership = await db.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId: me.id } },
  })
  if (!membership) return NextResponse.json({ error: "Not a member" }, { status: 403 })
  await db.conversationMember.update({
    where: { conversationId_userId: { conversationId, userId: me.id } },
    data: { lastReadAt: new Date() },
  })
  return NextResponse.json({ ok: true })
}
