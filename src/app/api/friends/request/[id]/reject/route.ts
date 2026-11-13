import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/session"
import { db } from "@/lib/db"

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const fr = await db.friendRequest.findUnique({ where: { id: params.id } })
  if (!fr || fr.toId !== me.id || fr.status !== "pending")
    return NextResponse.json({ error: "Request not found" }, { status: 404 })
  await db.friendRequest.update({ where: { id: fr.id }, data: { status: "rejected" } })
  return NextResponse.json({ ok: true })
}
