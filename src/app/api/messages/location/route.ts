import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/session"
import { errorJson, json } from "@/lib/serialize"
import { db } from "@/lib/db"

export async function POST(req: NextRequest) {
  const me = await getSessionUser()
  if (!me) return errorJson("Unauthorized", 401)
  const { conversationId, lat, lng, label } = await req.json()
  if (!conversationId || typeof lat !== "number" || typeof lng !== "number") {
    return errorJson("conversationId, lat, lng required", 400)
  }

  const membership = await db.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId: me.id } },
  })
  if (!membership) return errorJson("Not a member", 403)

  const message = await db.message.create({
    data: {
      conversationId,
      senderId: me.id,
      content: label || `Location: ${lat.toFixed(4)}, ${lng.toFixed(4)}`,
      type: "location",
      metadata: JSON.stringify({ lat, lng, label }),
    },
  })
  return json({ ok: true, message }, 201)
}
