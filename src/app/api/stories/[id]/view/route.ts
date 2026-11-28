import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { errorJson, json } from '@/lib/serialize'
import { handleRouteError } from '@/lib/api-errors'
import { decideStoryView } from '@/lib/story-access'

// POST mark a story as viewed.
//
// Audit finding 30: this route previously recorded a view for any authenticated
// user who knew a story ID. The decision now comes from `decideStoryView`, which
// requires the story to be unexpired (or a highlight), the viewer to be an
// accepted friend of the owner, and no block in either direction. Every denial is
// a 404 so the response does not reveal whether the story exists.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const me = await getSessionUser()
    if (!me) return errorJson('Unauthorized', 401)
    const { id } = await params

    const story = await db.story.findFirst({
      where: { id },
      select: { id: true, userId: true, expiresAt: true, isHighlight: true },
    })
    if (!story) return errorJson('Not found', 404)

    const now = new Date()
    const isOwner = story.userId === me.id
    let friendshipAccepted = isOwner
    let blocked = false
    if (!isOwner) {
      const [friendship, block] = await Promise.all([
        db.friendship.findFirst({
          where: {
            status: 'ACCEPTED',
            OR: [
              { requesterId: me.id, receiverId: story.userId },
              { requesterId: story.userId, receiverId: me.id },
            ],
          },
        }),
        db.block.findFirst({
          where: {
            OR: [
              { fromId: me.id, toId: story.userId },
              { fromId: story.userId, toId: me.id },
            ],
          },
        }),
      ])
      friendshipAccepted = Boolean(friendship)
      blocked = Boolean(block)
    }

    const decision = decideStoryView({
      viewerId: me.id,
      storyOwnerId: story.userId,
      expiresAt: new Date(story.expiresAt),
      isHighlight: Boolean(story.isHighlight),
      friendshipAccepted,
      blocked,
      now,
    })
    if (!decision.allowed) return errorJson('Not found', 404)

    if (decision.record) {
      await db.storyView.upsert({
        where: { storyId_userId: { storyId: story.id, userId: me.id } },
        update: {},
        create: { storyId: story.id, userId: me.id },
      })
    }
    return json({ ok: true, recorded: decision.record })
  } catch (error) {
    return handleRouteError(error, '/api/stories/[id]/view')
  }
}
