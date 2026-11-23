import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/session"
import { db } from "@/lib/db"

export async function GET(req: Request) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { searchParams } = new URL(req.url)
  const onlyUnread = searchParams.get("unread") === "1"
  const notifications = await db.notification.findMany({
    where: { userId: me.id, ...(onlyUnread ? { read: false } : {}) },
    orderBy: { createdAt: "desc" },
    take: 50,
  })
  const unreadCount = await db.notification.count({
    where: { userId: me.id, read: false },
  })
  return NextResponse.json({ notifications, unreadCount })
}

// Mark all as read
export async function PATCH() {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  await db.notification.updateMany({
    where: { userId: me.id, read: false },
    data: { read: true },
  })
  return NextResponse.json({ ok: true })
}
