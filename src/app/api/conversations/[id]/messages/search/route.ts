import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/session"
import { db } from "@/lib/db"

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const membership = await db.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId: params.id, userId: me.id } },
  })
  if (!membership) return NextResponse.json({ error: "Not a member" }, { status: 403 })
  const { searchParams } = new URL(req.url)
  const q = (searchParams.get("q") || "").trim()
  if (!q) return NextResponse.json({ messages: [] })

  const messages = await db.message.findMany({
    where: { conversationId: params.id, content: { contains: q }, deletedForAll: false },
    orderBy: { createdAt: "desc" },
    take: 30,
    include: {
      sender: { select: { id: true, username: true, name: true, avatarUrl: true } },
    },
  })
  return NextResponse.json({ messages: messages.reverse() })
}
