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
            // Name only. Email was matched here too, which turned this into an
            // account-enumeration oracle: any logged-in user could probe for
            // partial email substrings and learn who has an account.
            { name: { contains: lc } },
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
  // Always include Jara if query matches jara
  if ("jara".includes(lc) || lc.includes("jara") || lc.includes("ai")) {
    const hasJara = users.some((u: any) => u.id === "jara-ai-system-001" || u.username === "jara")
    if (!hasJara) {
      try {
        let jara = await db.user.findUnique({ where: { id: "jara-ai-system-001" }, select: { id: true, username: true, name: true, avatarUrl: true, status: true, lastSeenAt: true } }).catch(() => null)
        if (!jara) {
          // synthetic fallback
          jara = { id: "jara-ai-system-001", username: "jara", name: "Jara", avatarUrl: "/jara-avatar.svg", status: "AI Assistant • Online", lastSeenAt: new Date() } as any
        }
        users.unshift(jara)
      } catch {}
    }
  }
  return NextResponse.json({ users })
}
