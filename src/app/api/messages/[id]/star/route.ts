import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/session"
import { db } from "@/lib/db"
import { isMessageParticipant } from "@/lib/socket-security.cjs"

// Toggle star
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const messageId = (await params).id
  const msg = await db.message.findUnique({ where: { id: messageId } })
  if (!msg || !(await isMessageParticipant(db, me.id, msg))) {
    return NextResponse.json({ error: "Message not found" }, { status: 404 })
  }
  const existing = await db.messageStar.findUnique({
    where: { messageId_userId: { messageId, userId: me.id } },
  })
  if (existing) {
    await db.messageStar.delete({ where: { id: existing.id } })
    return NextResponse.json({ ok: true, action: "removed", starred: false })
  }
  await db.messageStar.create({ data: { userId: me.id, messageId } })
  return NextResponse.json({ ok: true, action: "added", starred: true })
}

export async function GET(_req: Request) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const starred = await db.messageStar.findMany({
    where: { userId: me.id },
    include: {
      message: {
        include: {
          sender: { select: { id: true, username: true, name: true, avatarUrl: true } },
          conversation: { select: { id: true, title: true, type: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  })
  return NextResponse.json({ starred })
}
