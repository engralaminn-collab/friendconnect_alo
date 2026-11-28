import { NextRequest } from 'next/server'
import { errorJson, json } from '@/lib/serialize'
import { getSessionUser } from '@/lib/session'
import { runTool } from '@/lib/jara-tools'

export async function POST(req: NextRequest) {
  const me = await getSessionUser()
  if (!me) return errorJson('Unauthorized', 401)

  let body: any
  try { body = await req.json() } catch { return errorJson('Invalid JSON', 400) }

  const name = typeof body?.name === 'string' ? body.name : ''
  if (!name.trim()) return errorJson('Tool name is required', 400)

  const result = await runTool(name, body?.args, { userId: me.id, actorRole: (me as any).role || null })
  if (!result.ok) {
    return errorJson(result.error || 'Tool failed', result.httpStatus || 400)
  }
  return json(result)
}
