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
  const q = (searchParams.get("q") || "").trim()
  if (!q) return NextResponse.json({ messages: [] })

  const messages = await db.message.findMany({
    where: { conversationId: (await params).id, content: { contains: q } },
    orderBy: { createdAt: "desc" },
    take: 30,
    include: {
      sender: { select: { id: true, username: true, name: true, avatarUrl: true } },
    },
  })
  return NextResponse.json({ messages: filterMessagesVisibleToUser<any>(messages, me.id).reverse() })
}
