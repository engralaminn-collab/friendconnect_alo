import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { errorJson, json } from '@/lib/serialize'
import { handleRouteError } from '@/lib/api-errors'

// POST /api/push/unsubscribe — remove a push subscription
export async function POST(req: NextRequest) {
  try {
    const me = await getSessionUser()
    if (!me) return errorJson('Unauthorized', 401)
    const body = await req.json()
    const { endpoint } = body
    if (!endpoint) return errorJson('endpoint required', 400)
    await db.pushSubscription.deleteMany({ where: { endpoint, userId: me.id } })
    return json({ ok: true })
  } catch (error) {
    return handleRouteError(error, '/api/push/unsubscribe')
  }
}
