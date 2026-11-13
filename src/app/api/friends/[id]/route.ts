import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/session"
import { db } from "@/lib/db"

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  // params.id here is the other user's id (we use it as the friend id)
  const otherId = params.id
  const fr = await db.friendship.findFirst({
    where: { OR: [{ userAId: me.id, userBId: otherId }, { userAId: otherId, userBId: me.id }] },
  })
  if (!fr) return NextResponse.json({ error: "Friendship not found" }, { status: 404 })
  await db.friendship.delete({ where: { id: fr.id } })
  return NextResponse.json({ ok: true })
}
