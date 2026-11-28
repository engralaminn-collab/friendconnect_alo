import { NextRequest } from 'next/server'
import { errorJson, json } from '@/lib/serialize'
import { requireSuperAdmin, requestMeta, writeJaraAudit } from '@/lib/jara-admin'
import { cancelJob, JaraJobStoreError } from '@/lib/jara-jobs'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let me
  try { me = await requireSuperAdmin() } catch (e: any) { return errorJson(e.message === 'UNAUTHORIZED' ? 'Unauthorized' : 'Forbidden — Super Admin only', e.status || 403) }
  const { id } = await params
  if (!id?.trim()) return errorJson('Job id required', 400)

  let body: any = {}
  try { body = await req.json() } catch { /* action defaults to cancel */ }
  const action = String(body?.action || 'cancel')
  if (action !== 'cancel') return errorJson('Only action=cancel is supported', 400)

  try {
    const job = await cancelJob(id.trim())
    await writeJaraAudit({
      action: 'config_change',
      actorId: me.id,
      actorRole: me.role,
      detail: `Jara job ${id} cancelled by Super Admin`,
      newValue: { id, status: 'cancelled' },
      authorizationResult: 'allowed',
      ...requestMeta(req),
    }).catch(() => {})
    return json({ ok: true, job })
  } catch (e: any) {
    if (e instanceof JaraJobStoreError) return errorJson(e.message, 409)
    return errorJson(e?.message || 'Cancel failed', 500)
  }
}
