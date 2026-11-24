import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/session"
import { db } from "@/lib/db"
import { filterMessagesVisibleToUser } from "@/lib/ai-input"

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
      reads: { select: { userId: true, readAt: true } },
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
  const membership = await db.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId: (await params).id, userId: me.id } },
  })
  if (!membership) return NextResponse.json({ error: "Not a member" }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const { content, replyToId, attachmentIds }: { content?: string; replyToId?: string; attachmentIds?: string[] } = body
  if (!content?.trim() && (!attachmentIds || attachmentIds.length === 0)) {
    return NextResponse.json({ error: "Empty message" }, { status: 400 })
  }

  const msg = await db.message.create({
    data: {
      conversationId: (await params).id,
      senderId: me.id,
      content: content?.trim() || "",
      replyToId: replyToId || null,
      ...(attachmentIds?.length
        ? { attachments: { connect: attachmentIds.map((id) => ({ id })) } }
        : {}),
    },
    include: {
      sender: { select: { id: true, username: true, name: true, avatarUrl: true } },
      attachments: true,
      reactions: { include: { user: { select: { id: true, username: true } } } },
      reads: { select: { userId: true, readAt: true } },
    },
  })

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
