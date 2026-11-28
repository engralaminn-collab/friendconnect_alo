import { NextRequest } from 'next/server'
import { errorJson, json } from '@/lib/serialize'
import { getSessionUser } from '@/lib/session'
import { listTools, getSearchProvider } from '@/lib/jara-tools'

export async function GET(_req: NextRequest) {
  const me = await getSessionUser()
  if (!me) return errorJson('Unauthorized', 401)
  // Tool metadata only — no execution, no secrets. Egress tools report their provider state.
  return json({
    tools: listTools(),
    searchProvider: getSearchProvider(),
    note: 'Tools run only via POST /api/jara/tools/run, as the signed-in user, and are written to the Jara audit log.',
  })
}
