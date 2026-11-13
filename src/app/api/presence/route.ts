import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/session"
import { db } from "@/lib/db"

export async function GET(req: Request) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { searchParams } = new URL(req.url)
  const userIds = searchParams.get("ids")
  if (!userIds) return NextResponse.json({ presence: {} })
  const ids = userIds.split(",").filter(Boolean)
  if (ids.length === 0) return NextResponse.json({ presence: {} })
  const users = await db.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, lastSeenAt: true, status: true },
  })
  const now = Date.now()
  const presence: Record<string, { online: boolean; lastSeenAt: string; status: string }> = {}
  for (const u of users) {
    // Online if lastSeenAt within last 60 seconds (heartbeat will update this)
    const online = now - u.lastSeenAt.getTime() < 60_000
    presence[u.id] = { online, lastSeenAt: u.lastSeenAt.toISOString(), status: u.status }
  }
  return NextResponse.json({ presence })
}
