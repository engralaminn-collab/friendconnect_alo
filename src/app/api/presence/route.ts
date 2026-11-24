import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/session"
import { db } from "@/lib/db"

export async function GET(req: Request) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const requested = new URL(req.url).searchParams.get("ids")
  const ids = Array.from(new Set((requested || "").split(",").map((id) => id.trim()).filter(Boolean))).slice(0, 100)
  if (ids.length === 0) return NextResponse.json({ presence: {} })

  const [friendships, blocks] = await Promise.all([
    db.friendship.findMany({
      where: {
        status: "ACCEPTED",
        OR: [{ requesterId: me.id }, { receiverId: me.id }],
      },
    }),
    db.block.findMany({
      where: { OR: [{ fromId: me.id }, { toId: me.id }] },
    }),
  ])
  const friendIds = new Set(friendships.map((f: any) => f.requesterId === me.id ? f.receiverId : f.requesterId))
  const blockedIds = new Set(blocks.map((b: any) => b.fromId === me.id ? b.toId : b.fromId))
  const authorizedIds = ids.filter((id) => id === me.id || (friendIds.has(id) && !blockedIds.has(id)))
  if (authorizedIds.length === 0) return NextResponse.json({ presence: {} })

  const users = await db.user.findMany({
    where: { id: { in: authorizedIds } },
    select: { id: true, lastSeenAt: true, status: true },
  })
  const profiles = await db.profile.findMany({
    where: { userId: { in: authorizedIds } },
    select: { userId: true, profileVisibility: true },
  })
  const visibility = new Map(profiles.map((p: any) => [p.userId, p.profileVisibility]))
  const now = Date.now()
  const presence: Record<string, { online: boolean; lastSeenAt: string; status: string }> = {}
  for (const user of users) {
    const isSelf = user.id === me.id
    if (!isSelf && visibility.get(user.id) === "PRIVATE") continue
    presence[user.id] = {
      online: now - user.lastSeenAt.getTime() < 60_000,
      lastSeenAt: user.lastSeenAt.toISOString(),
      status: user.status,
    }
  }
  return NextResponse.json({ presence }, { headers: { "Cache-Control": "private, no-store" } })
}
