import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/session"
import { errorJson, json } from "@/lib/serialize"
import { db } from "@/lib/db"

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const me = await getSessionUser()
  if (!me) return errorJson("Unauthorized", 401)
  const { optionIdx } = await req.json()
  if (typeof optionIdx !== "number") return errorJson("optionIdx required", 400)

  const poll = await db.poll.findUnique({ where: { id: params.id } })
  if (!poll) return errorJson("Poll not found", 404)

  // Check if already voted
  const existing = await db.pollVote.findUnique({
    where: { pollId_userId: { pollId: params.id, userId: me.id } },
  })
  if (existing) {
    // Update vote
    await db.pollVote.update({
      where: { id: existing.id },
      data: { optionIdx },
    })
  } else {
    await db.pollVote.create({
      data: { pollId: params.id, userId: me.id, optionIdx },
    })
  }

  // Return updated vote counts
  const votes = await db.pollVote.groupBy({
    by: ["optionIdx"],
    where: { pollId: params.id },
    _count: true,
  })
  return json({ ok: true, votes })
}
