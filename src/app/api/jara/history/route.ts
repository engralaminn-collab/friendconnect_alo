import { NextRequest } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { errorJson, json } from '@/lib/serialize'
import { db } from '@/lib/db'

export async function GET(req: NextRequest) {
  const me = await getSessionUser()
  if (!me) return errorJson('Unauthorized', 401)

  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit') || 50), 100)

  const logs = await (db as any).jaraAuditLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
  }).catch(() => [])

  const configs = await (db as any).jaraConfig.findMany({
    orderBy: { version: 'desc' },
    take: 20,
  }).catch(() => [])

  return json({ logs, configs })
}
