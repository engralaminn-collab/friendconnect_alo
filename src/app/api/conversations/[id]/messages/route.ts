import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/session"
import { db } from "@/lib/db"
import { filterMessagesVisibleToUser } from "@/lib/ai-input"
import { grantMessageFileAccess } from "@/lib/file-access"
import { emitRealtimeToUsers } from "@/lib/realtime-emit"

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const membership = await db.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId: (await params).id, userId: me.id } },
  })
  if (!membership) return NextResponse.json({ error: "Not a member" }, { status: 403 })
  const { searchParams } = new URL(req.url)
  const cursor = searchParams.get("cursor")
  const limit = Math.min(Number(searchParams.get("limit") || 50), 100)

  const messages = await db.message.findMany({
    where: { conversationId: (await params).id },
    orderBy: { createdAt: "desc" },
    take: limit,
    ...(cursor
      ? { skip: 1, cursor: { id: cursor } }
      : {}),
    include: {
      sender: { select: { id: true, username: true, name: true, avatarUrl: true } },
      attachments: true,
      reactions: { include: { user: { select: { id: true, username: true } } } },
      replyTo: { select: { id: true, content: true, senderId: true, sender: { select: { username: true, name: true } } } },
    },
  })
  const visibleMessages = filterMessagesVisibleToUser<any>(messages, me.id)
  return NextResponse.json({
    messages: visibleMessages.reverse(),
    nextCursor: visibleMessages.length === limit ? visibleMessages[visibleMessages.length - 1].id : null,
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

  const body = await req.json().catch(() => ({}))
  const { content, replyToId, attachmentIds }: { content?: string; replyToId?: string; attachmentIds?: string[] } = body
  const cleanAttachmentIds = Array.isArray(attachmentIds)
    ? Array.from(new Set(attachmentIds.filter((v): v is string => typeof v === "string" && v.length > 0)))
    : []
  if (!content?.trim() && cleanAttachmentIds.length === 0) {
    return NextResponse.json({ error: "Empty message" }, { status: 400 })
  }
  if (content && content.length > 10000) {
    return NextResponse.json({ error: "Message too long" }, { status: 400 })
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

  const members = await db.conversationMember.findMany({
    where: { conversationId },
    select: { userId: true },
  })
  const peers = members.map((m) => m.userId).filter((uid) => uid !== me.id)
  const firstAtt = ownedAttachments[0]

  const msg = await db.message.create({
    data: {
      conversationId,
      senderId: me.id,
      receiverId: peers.length === 1 ? peers[0] : null,
      content: content?.trim() || "",
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
      replyToId: replyToId || null,
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
    members.map((m) => m.userId),
    "message:new",
    msg,
  )

  return NextResponse.json({ message: msg }, { status: 201 })
}

// Mark conversation as read
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const membership = await db.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId: (await params).id, userId: me.id } },
  })
  if (!membership) return NextResponse.json({ error: "Not a member" }, { status: 403 })
  await db.conversationMember.update({
    where: { conversationId_userId: { conversationId: (await params).id, userId: me.id } },
    data: { lastReadAt: new Date() },
  })
  return NextResponse.json({ ok: true })
}
