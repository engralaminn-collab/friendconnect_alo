import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/session"
import { errorJson, json } from "@/lib/serialize"
import { handleRouteError } from "@/lib/api-errors"
import { db } from "@/lib/db"

/**
 * Create a poll message (finding #7).
 *
 * The poll row and the message that carries it are written in one transaction,
 * so a failure can never leave an orphan `Poll` with no message (which the UI
 * cannot render and no one can vote on) or a `messageType: "poll"` message with
 * no poll behind it.
 *
 * Input is validated before it reaches the database: `options` used to be
 * accepted as any array, so a client could post 10 000 options, empty strings,
 * or nested objects that later broke JSON.parse on every read.
 */

const MIN_OPTIONS = 2
const MAX_OPTIONS = 10
const MAX_OPTION_LENGTH = 200
const MAX_QUESTION_LENGTH = 300

export async function POST(req: NextRequest) {
  try {
    const me = await getSessionUser()
    if (!me) return errorJson("Unauthorized", 401)

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== "object") return errorJson("Invalid JSON body", 400)
    const { conversationId, question, options, expiresAt } = body as Record<string, unknown>

    if (typeof conversationId !== "string" || !conversationId) return errorJson("conversationId required", 400)
    if (typeof question !== "string" || !question.trim()) return errorJson("question required", 400)
    if (question.trim().length > MAX_QUESTION_LENGTH) {
      return errorJson(`question must be at most ${MAX_QUESTION_LENGTH} characters`, 400)
    }
    if (!Array.isArray(options) || options.length < MIN_OPTIONS) {
      return errorJson(`options[] with at least ${MIN_OPTIONS} entries required`, 400)
    }
    if (options.length > MAX_OPTIONS) return errorJson(`at most ${MAX_OPTIONS} options are allowed`, 400)

    const cleaned: string[] = []
    for (const option of options) {
      if (typeof option !== "string") return errorJson("every option must be a string", 400)
      const text = option.trim()
      if (!text) return errorJson("options cannot be blank", 400)
      if (text.length > MAX_OPTION_LENGTH) {
        return errorJson(`options must be at most ${MAX_OPTION_LENGTH} characters`, 400)
      }
      cleaned.push(text)
    }
    if (new Set(cleaned).size !== cleaned.length) return errorJson("options must be unique", 400)

    let expiry: Date | null = null
    if (expiresAt !== undefined && expiresAt !== null) {
      const parsed = new Date(String(expiresAt))
      if (Number.isNaN(parsed.getTime())) return errorJson("expiresAt must be a valid date", 400)
      if (parsed.getTime() <= Date.now()) return errorJson("expiresAt must be in the future", 400)
      expiry = parsed
    }

    // Verify membership: a non-member must not be able to inject a message into
    // someone else's conversation.
    const membership = await db.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId, userId: me.id } },
    })
    if (!membership) return errorJson("Not a member", 403)

    const result = await db.$transaction(async (tx: any) => {
      const message = await tx.message.create({
        data: {
          conversationId,
          senderId: me.id,
          content: question.trim(),
          // The column is `type` (see the Message model): `messageType` exists in
          // no schema, so every poll creation used to 500 on the built-in
          // backend with "table Message has no column named messageType".
          type: "poll",
          metadata: JSON.stringify({ question: question.trim(), options: cleaned }),
        },
      })
      const poll = await tx.poll.create({
        data: {
          messageId: message.id,
          question: question.trim(),
          options: JSON.stringify(cleaned),
          expiresAt: expiry,
        },
      })
      return { message, poll }
    })

    return json(
      {
        ok: true,
        message: result.message,
        poll: {
          id: result.poll.id,
          messageId: result.poll.messageId,
          question: result.poll.question,
          options: cleaned,
          expiresAt: result.poll.expiresAt,
          votes: [],
        },
      },
      201,
    )
  } catch (error) {
    return handleRouteError(error, "POST /api/polls/create")
  }
}
