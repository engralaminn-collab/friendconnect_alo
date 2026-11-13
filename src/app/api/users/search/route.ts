import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/session"
import { db } from "@/lib/db"

export async function GET(req: Request) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { searchParams } = new URL(req.url)
  const q = (searchParams.get("q") || "").trim()
  if (!q || q.length < 2) return NextResponse.json({ users: [] })
  const lc = q.toLowerCase()
  const users = await db.user.findMany({
    where: {
      AND: [
        { id: { not: me.id } },
        {
          OR: [
            { username: { contains: lc } },
            { name: { contains: lc } },
            { email: { contains: lc } },
          ],
        },
      ],
    },
    select: {
      id: true,
      username: true,
      name: true,
      avatarUrl: true,
      status: true,
      lastSeenAt: true,
    },
    take: 20,
  })
  return NextResponse.json({ users })
}
