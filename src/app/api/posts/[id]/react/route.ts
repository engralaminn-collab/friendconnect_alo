import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/session"
import { errorJson, json } from "@/lib/serialize"
import { db } from "@/lib/db"

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await getSessionUser()
  if (!me) return errorJson("Unauthorized", 401)
  const { emoji } = await req.json()
  if (!emoji) return errorJson("emoji required", 400)

  const existing = await db.postReaction.findUnique({
    where: { postId_userId_emoji: { postId: (await params).id, userId: me.id, emoji } },
  })
  if (existing) {
    await db.postReaction.delete({ where: { id: existing.id } })
    return json({ ok: true, action: "removed" })
  }
  await db.postReaction.create({
    data: { postId: (await params).id, userId: me.id, emoji },
  })
  return json({ ok: true, action: "added" })
}
