import { NextRequest } from 'next/server'
import { errorJson, json } from '@/lib/serialize'
import { db } from '@/lib/db'
import { requireSuperAdmin } from '@/lib/jara-admin'

// This endpoint returns global administrative audit/configuration history.
export async function GET(req: NextRequest) {
  try {
    await requireSuperAdmin()
  } catch (e: any) {
    return errorJson(e?.message === 'UNAUTHORIZED' ? 'Unauthorized' : 'Forbidden — Super Admin only', e?.status || 403)
  }

  const requestedLimit = Number(req.nextUrl.searchParams.get('limit') || 50)
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(Math.trunc(requestedLimit), 100)) : 50

  const [logs, configs] = await Promise.all([
    (db as any).jaraAuditLog.findMany({ orderBy: { createdAt: 'desc' }, take: limit }).catch(() => []),
    (db as any).jaraConfig.findMany({ orderBy: { version: 'desc' }, take: 20 }).catch(() => []),
  ])

  return json({ logs, configs })
}
