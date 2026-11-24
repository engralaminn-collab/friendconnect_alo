import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/session"
import { errorJson, json } from "@/lib/serialize"
import { handleRouteError } from "@/lib/api-errors"
import { db } from "@/lib/db"

/**
 * Vote in a poll (finding #7).
 *
 * Fixes, in order of severity:
 *
 *  1. **Authorization.** Any signed-in user could vote in any poll — the route
 *     only checked that the poll existed. Voting is now limited to participants
 *     of the message that carries the poll (DM sender/recipient, or members of
 *     the group), which is the same primitive the reactions route uses.
 *  2. **Atomicity.** The read-then-write pair (`findUnique` then `update` or
 *     `create`) raced: two concurrent requests could both see "no vote" and hit
 *     the `@@unique([pollId, userId])` constraint, turning a normal double-tap
 *     into a 500. It is now a single `upsert`, so last write wins without error.
 *  3. **Validation.** `optionIdx` only had to be a *number*; `-1`, `1.5` and
 *     `999` were all stored and then corrupted every result table. It must be an
 *     integer inside the poll's option range.
 *  4. **Closed polls.** `Poll.expiresAt` was stored but never enforced, so a
 *     poll could be voted on forever. Expired polls now reject new votes (while
 *     still returning the final tally).
 *  5. **Response shape.** `groupBy({ _count: true })` returns provider-specific
 *     shapes (`_count` vs `_count: { _all }`). The route now projects a stable
 *     `tally` array plus the caller's own vote, so the client never has to
 *     interpret a raw grouped query.
 */

type Tally = { optionIdx: number; count: number }

function parseOptions(raw: unknown): string[] {
  if (typeof raw !== "string") return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map((value) => String(value)) : []
  } catch {
    return []
  }
}

/** Normalise the different `groupBy` result shapes into a dense tally. */
function buildTally(votes: Array<Record<string, unknown>>, optionCount: number): Tally[] {
  const counts = new Map<number, number>()
  for (const row of votes) {
    const idx = Number((row as { optionIdx?: unknown }).optionIdx)
    if (!Number.isInteger(idx) || idx < 0 || idx >= optionCount) continue
    const raw = (row as { _count?: unknown })._count
    const value =
      typeof raw === "number"
        ? raw
        : raw && typeof raw === "object" && typeof (raw as { _all?: unknown })._all === "number"
          ? (raw as { _all: number })._all
          : 0
    counts.set(idx, value)
  }
  return Array.from({ length: optionCount }, (_, optionIdx) => ({
    optionIdx,
    count: counts.get(optionIdx) ?? 0,
  }))
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const me = await getSessionUser()
    if (!me) return errorJson("Unauthorized", 401)

    const { id: pollId } = await params
    const body = await req.json().catch(() => null)
    const optionIdx = (body as { optionIdx?: unknown } | null)?.optionIdx
    if (typeof optionIdx !== "number" || !Number.isInteger(optionIdx) || optionIdx < 0) {
      return errorJson("optionIdx must be a non-negative integer", 400)
    }

    const poll = await db.poll.findUnique({ where: { id: pollId } })
    if (!poll) return errorJson("Poll not found", 404)

    const options = parseOptions(poll.options)
    if (optionIdx >= options.length) {
      return errorJson(`optionIdx must be between 0 and ${options.length - 1}`, 400)
    }

    // 1. Only participants of the poll's message may vote.
    const message = await db.message.findUnique({
      where: { id: poll.messageId },
      select: { id: true, senderId: true, receiverId: true, groupId: true, conversationId: true },
    })
    if (!message) return errorJson("Poll not found", 404)

    let isParticipant = message.senderId === me.id || message.receiverId === me.id
    if (!isParticipant && message.groupId) {
      isParticipant = Boolean(
        await db.groupMember.findUnique({
          where: { groupId_userId: { groupId: message.groupId, userId: me.id } },
          select: { id: true },
        }),
      )
    }
    if (!isParticipant && message.conversationId) {
      isParticipant = Boolean(
        await db.conversationMember.findUnique({
          where: { conversationId_userId: { conversationId: message.conversationId, userId: me.id } },
          select: { id: true },
        }),
      )
    }
    if (!isParticipant) return errorJson("You are not a participant in this poll", 403)

    // 4. Closed polls stop accepting votes but still show the result.
    const expired = Boolean(poll.expiresAt && new Date(poll.expiresAt).getTime() <= Date.now())

    if (!expired) {
      // 2. Single atomic write; changing your mind updates the same row.
      await db.pollVote.upsert({
        where: { pollId_userId: { pollId, userId: me.id } },
        update: { optionIdx },
        create: { pollId, userId: me.id, optionIdx },
      })
    }

    const tally = buildTally(
      (await db.pollVote.groupBy({ by: ["optionIdx"], where: { pollId }, _count: true })) as Array<
        Record<string, unknown>
      >,
      options.length,
    )

    return json({
      ok: true,
      expired,
      pollId,
      options,
      tally,
      totalVotes: tally.reduce((sum, entry) => sum + entry.count, 0),
      myVote: expired ? null : optionIdx,
    })
  } catch (error) {
    return handleRouteError(error, "POST /api/polls/[id]/vote")
  }
}

/** Read the current results without voting (participants only). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const me = await getSessionUser()
    if (!me) return errorJson("Unauthorized", 401)

    const { id: pollId } = await params
    const poll = await db.poll.findUnique({ where: { id: pollId } })
    if (!poll) return errorJson("Poll not found", 404)
    const options = parseOptions(poll.options)

    const message = await db.message.findUnique({
      where: { id: poll.messageId },
      select: { id: true, senderId: true, receiverId: true, groupId: true, conversationId: true },
    })
    if (!message) return errorJson("Poll not found", 404)

    let isParticipant = message.senderId === me.id || message.receiverId === me.id
    if (!isParticipant && message.groupId) {
      isParticipant = Boolean(
        await db.groupMember.findUnique({
          where: { groupId_userId: { groupId: message.groupId, userId: me.id } },
          select: { id: true },
        }),
      )
    }
    if (!isParticipant && message.conversationId) {
      isParticipant = Boolean(
        await db.conversationMember.findUnique({
          where: { conversationId_userId: { conversationId: message.conversationId, userId: me.id } },
          select: { id: true },
        }),
      )
    }
    if (!isParticipant) return errorJson("You are not a participant in this poll", 403)

    const mine = await db.pollVote.findUnique({
      where: { pollId_userId: { pollId, userId: me.id } },
      select: { optionIdx: true },
    })
    const grouped = await db.pollVote.groupBy({
      by: ["optionIdx"],
      where: { pollId },
      _count: true,
    })

    return json({
      ok: true,
      pollId,
      question: poll.question,
      options,
      expiresAt: poll.expiresAt,
      expired: Boolean(poll.expiresAt && new Date(poll.expiresAt).getTime() <= Date.now()),
      tally: buildTally(grouped as Array<Record<string, unknown>>, options.length),
      myVote: mine?.optionIdx ?? null,
    })
  } catch (error) {
    return handleRouteError(error, "GET /api/polls/[id]/vote")
  }
}
