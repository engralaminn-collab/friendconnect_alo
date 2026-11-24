import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/session"
import { db } from "@/lib/db"
import { revokeMessageGrants } from "@/lib/file-access"

// Edit a message
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const msg = await db.message.findUnique({ where: { id: (await params).id }, select: { id: true, senderId: true, conversationId: true } })
  if (!msg) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (msg.senderId !== me.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const { content } = await req.json().catch(() => ({}))
  if (!content || !content.trim()) return NextResponse.json({ error: "Empty" }, { status: 400 })
  const updated = await db.message.update({
    where: { id: (await params).id },
    data: { content: content.trim(), editedAt: new Date() },
    include: {
      sender: { select: { id: true, username: true, name: true, avatarUrl: true } },
      attachments: true,
      reactions: { include: { user: { select: { id: true, username: true } } } },
      // NOTE: there is no per-message read receipt relation. `reads` was selected
      // here against a `MessageRead` model that exists in no schema and is never
      // written, so it could only fail or return undefined. Read state is tracked
      // with `Message.status`/`seenAt` (per conversation) instead.
    },
  })
  return NextResponse.json({ message: updated })
}

// Delete a message (for self only or for everyone if sender)
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const msg = await db.message.findUnique({
    where: { id: (await params).id },
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

  if (scope === "all") {
    if (msg.senderId !== me.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    await db.message.update({
      where: { id: (await params).id },
      data: { deletedFor: "everyone", content: "", fileUrl: null, fileName: null, fileSize: null, mimeType: null },
    })
    // Withdraw the attachment: delete only the grants this message created so
    // the same upload stays reachable from any other thread that shares it.
    await revokeMessageGrants({ id: (await params).id })
    return NextResponse.json({ ok: true, deletedForAll: true })
  }

  const raw = typeof msg.deletedFor === "string" ? msg.deletedFor.trim() : ""
  if (raw !== "everyone") {
    const existing = raw === "me" ? [msg.senderId] : raw.split(",").map((value) => value.trim()).filter(Boolean)
    if (!existing.includes(me.id)) existing.push(me.id)
    await db.message.update({ where: { id: (await params).id }, data: { deletedFor: existing.join(",") } })
  }
  return NextResponse.json({ ok: true, scope: "self" })
}
