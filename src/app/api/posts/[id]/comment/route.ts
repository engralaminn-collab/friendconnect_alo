import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/session"
import { errorJson, json } from "@/lib/serialize"
import { db } from "@/lib/db"

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const me = await getSessionUser()
  if (!me) return errorJson("Unauthorized", 401)
  const { content } = await req.json()
  if (!content?.trim()) return errorJson("Content required", 400)

  const comment = await db.postComment.create({
    data: {
      postId: params.id,
      authorId: me.id,
      content: content.trim(),
    },
    include: {
      author: { select: { id: true, name: true, avatarUrl: true } },
    },
  })
  return json({ comment }, 201)
}
