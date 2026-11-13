import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/session"
import { db } from "@/lib/db"

// Toggle star
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const existing = await db.starredMessage.findUnique({
    where: { userId_messageId: { userId: me.id, messageId: params.id } },
  })
  if (existing) {
    await db.starredMessage.delete({ where: { id: existing.id } })
    return NextResponse.json({ ok: true, action: "removed" })
  }
  await db.starredMessage.create({ data: { userId: me.id, messageId: params.id } })
  return NextResponse.json({ ok: true, action: "added" })
}

export async function GET(_req: Request) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const starred = await db.starredMessage.findMany({
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
