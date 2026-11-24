import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { errorJson, json } from '@/lib/serialize'
import { handleRouteError } from '@/lib/api-errors'

// POST mark a story as viewed
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const me = await getSessionUser()
    if (!me) return errorJson('Unauthorized', 401)
    const { id } = await params
    await db.storyView.upsert({
      where: { storyId_userId: { storyId: id, userId: me.id } },
      update: {},
      create: { storyId: id, userId: me.id },
    })
    return json({ ok: true })
  } catch (error) {
    return handleRouteError(error, '/api/stories/[id]/view')
  }
}
