import { NextRequest } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { errorJson, json } from '@/lib/serialize'
import { resolvePresentationForSession, releasePresentationForSession } from '@/lib/jara-presentation'

export async function GET(req: NextRequest) {
  const me = await getSessionUser()
  if (!me) return errorJson('Unauthorized', 401)
  const sessionId = String(req.nextUrl.searchParams.get('sessionId') || '')
  const sessionType = String(req.nextUrl.searchParams.get('sessionType') || 'video_call')
  if (!sessionId) return errorJson('sessionId required', 400)
  const presentation = await resolvePresentationForSession({ sessionId, sessionType, reserveNextCall: true, actorId: me.id })
  return json({ presentation })
}

export async function POST(req: NextRequest) {
  const me = await getSessionUser()
  if (!me) return errorJson('Unauthorized', 401)
  let body: any
  try { body = await req.json() } catch { return errorJson('Invalid JSON', 400) }
  const action = String(body.action || 'resolve')
  const sessionId = String(body.sessionId || '')
  const sessionType = String(body.sessionType || 'video_call')
  if (!sessionId) return errorJson('sessionId required', 400)
  if (action === 'release') {
    const outcome = String(body.outcome || 'completed') as any
    const result = await releasePresentationForSession({ sessionId, outcome })
    return json(result)
  }
  const presentation = await resolvePresentationForSession({ sessionId, sessionType, reserveNextCall: body.reserveNextCall !== false, actorId: me.id })
  return json({ presentation })
}