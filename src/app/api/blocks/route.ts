import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/session"
import { db } from "@/lib/db"

export async function GET() {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const blocked = await db.block.findMany({
    where: { fromId: me.id },
    include: { to: { select: { id: true, username: true, name: true, avatarUrl: true } } },
    orderBy: { createdAt: "desc" },
  })
  return NextResponse.json({ blocked: blocked.map((b) => ({ id: b.id, to: b.to, createdAt: b.createdAt })) })
}

export async function POST(req: Request) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { toId } = await req.json().catch(() => ({}))
  if (!toId || toId === me.id)
    return NextResponse.json({ error: "Invalid target" }, { status: 400 })
  const exists = await db.block.findUnique({ where: { fromId_toId: { fromId: me.id, toId } } })
  if (exists) return NextResponse.json({ ok: true, existed: true })
  await db.block.create({ data: { fromId: me.id, toId } })
  // also remove friendship if any
  await db.friendship.deleteMany({
    where: { OR: [{ requesterId: me.id, receiverId: toId }, { requesterId: toId, receiverId: me.id }] },
  })
  return NextResponse.json({ ok: true })
}
