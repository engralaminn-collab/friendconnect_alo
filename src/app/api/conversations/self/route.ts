import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/session"
import { errorJson, json } from "@/lib/serialize"
import { db } from "@/lib/db"

// Create or get the "self" conversation (chat with yourself)
export async function POST(req: NextRequest) {
  const me = await getSessionUser()
  if (!me) return errorJson("Unauthorized", 401)

  // Check if a self-conversation already exists
  const existing = await db.conversation.findFirst({
    where: {
      type: "self",
      members: { some: { userId: me.id } },
    },
  })
  if (existing) return json({ conversation: existing })

  // Create new self-conversation
  const conv = await db.conversation.create({
    data: {
      type: "self",
      ownerId: me.id,
      members: { create: [{ userId: me.id, role: "owner" }] },
    },
  })
  return json({ conversation: conv }, 201)
}
