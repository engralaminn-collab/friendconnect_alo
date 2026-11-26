import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/session"
import { db } from "@/lib/db"
import { revokeMessageGrants } from "@/lib/file-access"
import { emitRealtimeToUsers } from "@/lib/realtime-emit"

async function recipientsForMessage(msg: { senderId: string; receiverId?: string | null; groupId?: string | null; conversationId?: string | null }) {
  if (msg.conversationId) {
    const members = await db.conversationMember.findMany({
      where: { conversationId: msg.conversationId },
      select: { userId: true },
    })
    return members.map((m) => m.userId)
  }
  if (msg.groupId) {
    const members = await db.groupMember.findMany({
      where: { groupId: msg.groupId },
      select: { userId: true },
    })
    return members.map((m) => m.userId)
  }
  return [msg.senderId, msg.receiverId].filter((v): v is string => typeof v === "string" && v.length > 0)
}

// Edit a message
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const messageId = (await params).id
  const msg = await db.message.findUnique({ where: { id: messageId }, select: { id: true, senderId: true, receiverId: true, groupId: true, conversationId: true } })
  if (!msg) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (msg.senderId !== me.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const { content } = await req.json().catch(() => ({}))
  if (!content || !content.trim()) return NextResponse.json({ error: "Empty" }, { status: 400 })
  const updated = await db.message.update({
    where: { id: messageId },
    data: { content: content.trim(), edited: true, editedAt: new Date() },
    include: {
      sender: { select: { id: true, username: true, name: true, avatarUrl: true } },
      attachments: true,
      reactions: { include: { user: { select: { id: true, username: true } } } },
    },
  })
  const recipients = await recipientsForMessage(msg)
  await emitRealtimeToUsers(recipients, "message:updated", {
    ...updated,
    conversationId: msg.conversationId ?? null,
  })
  return NextResponse.json({ message: updated })
}

// Delete a message (for self only or for everyone if sender)
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const messageId = (await params).id
  const msg = await db.message.findUnique({
    where: { id: messageId },
    select: { id: true, senderId: true, receiverId: true, groupId: true, conversationId: true, deletedFor: true },
  })
  if (!msg) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const { searchParams } = new URL(req.url)
  const scope = searchParams.get("scope") || "self"

  let isParticipant = msg.senderId === me.id || msg.receiverId === me.id
  if (msg.groupId) {
    isParticipant = !!await db.groupMember.findUnique({ where: { groupId_userId: { groupId: msg.groupId, userId: me.id } } })
  } else if (msg.conversationId) {
    isParticipant = !!await db.conversationMember.findUnique({ where: { conversationId_userId: { conversationId: msg.conversationId, userId: me.id } } })
  }
  if (!isParticipant) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  if (scope === "all" || scope === "everyone") {
    if (msg.senderId !== me.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    await db.message.update({
      where: { id: messageId },
      data: { deletedFor: "everyone", content: "", fileUrl: null, fileName: null, fileSize: null, mimeType: null },
    })
    // Withdraw the attachment: delete only the grants this message created so
    // the same upload stays reachable from any other thread that shares it.
    await revokeMessageGrants({ id: messageId })
    const recipients = await recipientsForMessage(msg)
    await emitRealtimeToUsers(recipients, "message:deleted", {
      id: messageId,
      messageId,
      conversationId: msg.conversationId ?? null,
      deletedFor: "everyone",
    })
    return NextResponse.json({ ok: true, deletedFor: true })
  }

  const raw = typeof msg.deletedFor === "string" ? msg.deletedFor.trim() : ""
  if (raw !== "everyone") {
    const existing = raw === "me" ? [msg.senderId] : raw.split(",").map((value) => value.trim()).filter(Boolean)
    if (!existing.includes(me.id)) existing.push(me.id)
    await db.message.update({ where: { id: messageId }, data: { deletedFor: existing.join(",") } })
  }
  await emitRealtimeToUsers([me.id], "message:deleted", {
    id: messageId,
    messageId,
    conversationId: msg.conversationId ?? null,
    deletedFor: "me",
    deletedFor: false,
  })
  return NextResponse.json({ ok: true, scope: "self" })
}
