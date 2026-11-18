import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/session"
import { errorJson, json } from "@/lib/serialize"
import { db } from "@/lib/db"

export async function POST(req: NextRequest) {
  const me = await getSessionUser()
  if (!me) return errorJson("Unauthorized", 401)
  const { conversationId, question, options } = await req.json()
  if (!conversationId || !question || !Array.isArray(options) || options.length < 2) {
    return errorJson("conversationId, question, and options[] (min 2) required", 400)
  }

  // Verify membership
  const membership = await db.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId: me.id } },
  })
  if (!membership) return errorJson("Not a member", 403)

  // Create message + poll in a transaction
  const result = await db.$transaction(async (tx) => {
    const message = await tx.message.create({
      data: {
        conversationId,
        senderId: me.id,
        content: question,
        messageType: "poll",
        metadata: JSON.stringify({ question, options }),
      },
    })
    const poll = await tx.poll.create({
      data: {
        messageId: message.id,
        question,
        options: JSON.stringify(options),
      },
    })
    return { message, poll }
  })

  return json({ ok: true, message: result.message, poll: result.poll }, 201)
}
