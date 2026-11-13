import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/session"
import { db } from "@/lib/db"

// Toggle reaction
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { emoji } = await req.json().catch(() => ({}))
  if (!emoji || typeof emoji !== "string" || emoji.length > 8)
    return NextResponse.json({ error: "Invalid emoji" }, { status: 400 })

  const msg = await db.message.findUnique({ where: { id: params.id }, select: { id: true, conversationId: true } })
  if (!msg) return NextResponse.json({ error: "Not found" }, { status: 404 })
  // membership check
  const membership = await db.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId: msg.conversationId, userId: me.id } },
  })
  if (!membership) return NextResponse.json({ error: "Not a member" }, { status: 403 })

  const existing = await db.messageReaction.findUnique({
    where: { messageId_userId_emoji: { messageId: params.id, userId: me.id, emoji } },
  })
  if (existing) {
    await db.messageReaction.delete({ where: { id: existing.id } })
    return NextResponse.json({ ok: true, action: "removed" })
  }
  const reaction = await db.messageReaction.create({
    data: { messageId: params.id, userId: me.id, emoji },
  })
  return NextResponse.json({ ok: true, action: "added", reaction })
}
