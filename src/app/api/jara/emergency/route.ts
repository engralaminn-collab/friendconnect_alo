import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { errorJson, json } from '@/lib/serialize'
import { requireSuperAdmin, writeJaraAudit, requestMeta, getLiveJaraConfig } from '@/lib/jara-admin'

export async function GET() {
  const cfg = await getLiveJaraConfig()
  return json({ isEnabled: cfg?.isEnabled !== false, displayName: cfg?.displayName || 'Jara AI' })
}

export async function POST(req: NextRequest) {
  let me
  try { me = await requireSuperAdmin() } catch (e: any) { return errorJson(e.message === 'UNAUTHORIZED' ? 'Unauthorized' : 'Forbidden — Super Admin only', e.status || 403) }
  let body: any
  try { body = await req.json() } catch { return errorJson('Invalid JSON', 400) }
  const enabled = Boolean(body.enabled)
  const reason = String(body.reason || '').slice(0, 500)

  const live = await (db as any).jaraConfig.findFirst({ where: { isLive: true }, orderBy: { version: 'desc' } })
  if (!live) return errorJson('No live Jara config found', 404)

  const prev = live.isEnabled !== false
  const updated = await (db as any).jaraConfig.update({ where: { id: live.id }, data: { isEnabled: enabled } })
  const meta = requestMeta(req)
  await writeJaraAudit({
    action: enabled ? 'emergency_enable' : 'emergency_disable',
    actorId: me.id,
    actorRole: me.role,
    version: live.version,
    detail: `${enabled ? 'Enabled' : 'Disabled'} Jara AI. Reason: ${reason || 'none'}`,
    previousValue: { isEnabled: prev },
    newValue: { isEnabled: enabled },
    authorizationResult: 'allowed',
    changeReason: reason || null,
    ...meta,
  })
  return json({ ok: true, isEnabled: updated.isEnabled !== false, config: updated })
}