import { NextRequest } from 'next/server'
import { errorJson, json } from '@/lib/serialize'
import { requireSuperAdmin, requestMeta, writeJaraAudit } from '@/lib/jara-admin'
import { listJobs, jobStats } from '@/lib/jara-jobs'

export async function GET(req: NextRequest) {
  let me
  try { me = await requireSuperAdmin() } catch (e: any) { return errorJson(e.message === 'UNAUTHORIZED' ? 'Unauthorized' : 'Forbidden — Super Admin only', e.status || 403) }

  const status = req.nextUrl.searchParams.get('status') || undefined
  const limit = Number(req.nextUrl.searchParams.get('limit') || 25)

  try {
    const [jobs, stats] = await Promise.all([listJobs({ status, limit }), jobStats()])
    return json({ jobs, stats, note: 'Durable registry on FriendConnect DB. Workers claim jobs explicitly; nothing self-executes.' })
  } catch (e: any) {
    await writeJaraAudit({
      action: 'attempt_blocked',
      actorId: me.id,
      actorRole: me.role,
      detail: `Job registry read failed: ${e?.message || e}`.slice(0, 300),
      authorizationResult: 'error',
      ...requestMeta(req),
    }).catch(() => {})
    return errorJson('Job registry unavailable. Has the JaraJob migration been applied (npm run db:push)?', 503)
  }
}
