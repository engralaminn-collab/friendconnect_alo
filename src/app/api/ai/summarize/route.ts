import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/session"
import { errorJson, json } from "@/lib/serialize"
import { aiSummarize, isAIConfigured } from "@/lib/ai"
import { db } from "@/lib/db"

export async function POST(req: NextRequest) {
  const me = await getSessionUser()
  if (!me) return errorJson("Unauthorized", 401)
  const { conversationId } = await req.json()
  if (!conversationId) return errorJson("conversationId required", 400)

  // Verify membership
  const membership = await db.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId: me.id } },
  })
  if (!membership) return errorJson("Not a member", 403)

  if (!isAIConfigured()) {
    return errorJson("AI not configured", 503)
  }

  // Fetch last 50 messages
  const messages = await db.message.findMany({
    where: { conversationId, deletedForAll: false },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { sender: { select: { name: true } } },
  })
  const formatted = messages.reverse().map(m => ({
    sender: m.sender.name,
    content: m.content,
  }))
  const summary = await aiSummarize(formatted)
  return json({ summary })
}
