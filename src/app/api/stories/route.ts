import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { errorJson, json } from '@/lib/serialize'
import { handleRouteError } from '@/lib/api-errors'

export async function GET() {
  try {
    const me = await getSessionUser()
    if (!me) return errorJson('Unauthorized', 401)
    const now = new Date()
    const friendships = await db.friendship.findMany({
      where: { status: 'ACCEPTED', OR: [{ requesterId: me.id }, { receiverId: me.id }] },
    })
    const friendIds = new Set<string>(friendships.map((f) => (f.requesterId === me.id ? f.receiverId : f.requesterId)))
    friendIds.add(me.id)

    const mutedIds = new Set<string>()
    for (const f of friendships) {
      const other = f.requesterId === me.id ? f.receiverId : f.requesterId
      if (f.storiesMuted) mutedIds.add(other)
    }

    const stories = await db.story.findMany({
      where: {
        userId: { in: Array.from(friendIds) },
        OR: [{ expiresAt: { gt: now } }, { isHighlight: true }],
      },
      orderBy: { createdAt: 'desc' },
      include: {
        user: { include: { profile: true } },
        views: true,
        reactions: { include: { user: { select: { id: true, name: true } } } },
      },
    })

    const byUser = new Map<string, any>()
    for (const s of stories) {
      const u = s.user
      if (mutedIds.has(u.id) && !s.isHighlight) continue
      if (!byUser.has(u.id)) {
        byUser.set(u.id, {
          userId: u.id, name: u.name, username: u.username,
          photoUrl: u.profile?.photoUrl ?? null,
          isMe: u.id === me.id,
          storiesMuted: mutedIds.has(u.id),
          stories: [], highlights: [],
        })
      }
      const entry = byUser.get(u.id)
      const data = {
        id: s.id, type: s.type, content: s.content, bg: s.bg,
        createdAt: s.createdAt.toISOString(),
        expiresAt: s.expiresAt.toISOString(),
        isHighlight: s.isHighlight,
        viewedByMe: s.views.some((v) => v.userId === me.id),
        viewCount: s.views.length,
        reactionCount: s.reactions.length,
        myReaction: s.reactions.find((r) => r.userId === me.id)?.emoji || null,
      }
      if (s.isHighlight) entry.highlights.push(data)
      else entry.stories.push(data)
    }
    return json({ stories: Array.from(byUser.values()) })
  } catch (error) {
    return handleRouteError(error, '/api/stories')
  }
}

// POST /api/stories — text | image | video
export async function POST(req: NextRequest) {
  try {
    const me = await getSessionUser()
    if (!me) return errorJson('Unauthorized', 401)
    const body = await req.json()
    const validTypes = ['text', 'image', 'video']
    const type = validTypes.includes(body.type) ? body.type : 'text'
    const content = String(body.content || '')
    const bg = body.bg ? String(body.bg) : null

    if (!content) return errorJson('content required (text/URL)', 400)

    const story = await db.story.create({
      data: {
        userId: me.id, type, content, bg,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    })
    return json({ story: { id: story.id, type: story.type } })
  } catch (error) {
    return handleRouteError(error, '/api/stories')
  }
}
