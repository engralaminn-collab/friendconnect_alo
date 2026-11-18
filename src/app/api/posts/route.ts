import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/session"
import { errorJson, json } from "@/lib/serialize"
import { db } from "@/lib/db"

export async function GET() {
  const me = await getSessionUser()
  if (!me) return errorJson("Unauthorized", 401)

  const posts = await db.post.findMany({
    where: {
      OR: [
        { visibility: "public" },
        { visibility: "friends", authorId: me.id },
      ],
    },
    include: {
      author: { select: { id: true, name: true, username: true, avatarUrl: true } },
      comments: { include: { author: { select: { id: true, name: true, avatarUrl: true } } }, orderBy: { createdAt: "asc" } },
      reactions: { select: { emoji: true, userId: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  })
  return json({ posts })
}

export async function POST(req: NextRequest) {
  const me = await getSessionUser()
  if (!me) return errorJson("Unauthorized", 401)
  const { content, mediaUrl, visibility } = await req.json()
  if (!content?.trim()) return errorJson("Content required", 400)

  const post = await db.post.create({
    data: {
      authorId: me.id,
      content: content.trim(),
      mediaUrl: mediaUrl || null,
      visibility: visibility || "friends",
    },
    include: {
      author: { select: { id: true, name: true, username: true, avatarUrl: true } },
    },
  })
  return json({ post }, 201)
}
