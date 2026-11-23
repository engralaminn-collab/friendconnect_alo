import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { errorJson, json } from '@/lib/serialize'
import { requireSuperAdmin, writeJaraAudit, requestMeta } from '@/lib/jara-admin'

export async function GET() {
  try { await requireSuperAdmin() } catch (e: any) { return errorJson(e.message === 'UNAUTHORIZED' ? 'Unauthorized' : 'Forbidden — Super Admin only', e.status || 403) }
  const integrations = await (db as any).jaraMeetingIntegration.findMany({ orderBy: { updatedAt: 'desc' } }).catch(() => [])
  // Redact config secrets from response
  const safe = integrations.map((i: any) => ({ ...i, config: i.config ? '[configured]' : null }))
  return json({ integrations: safe })
}

export async function POST(req: NextRequest) {
  let me
  try { me = await requireSuperAdmin() } catch (e: any) { return errorJson(e.message === 'UNAUTHORIZED' ? 'Unauthorized' : 'Forbidden — Super Admin only', e.status || 403) }
  let body: any
  try { body = await req.json() } catch { return errorJson('Invalid JSON', 400) }
  const platform = String(body.platform || '').trim().slice(0, 40)
  if (!platform) return errorJson('platform required', 400)
  const integration = await (db as any).jaraMeetingIntegration.create({ data: {
    platform,
    displayName: String(body.displayName || platform).slice(0, 120),
    enabled: Boolean(body.enabled),
    config: body.config ? (typeof body.config === 'string' ? body.config : JSON.stringify(body.config)) : null,
    authStatus: body.config ? 'configured' : 'not_configured',
    createdBy: me.id, updatedBy: me.id,
  } })
  const meta = requestMeta(req)
  await writeJaraAudit({ action: 'config_change', actorId: me.id, actorRole: me.role, detail: `Created meeting integration ${integration.platform}`, newValue: { id: integration.id, platform, enabled: integration.enabled }, authorizationResult: 'allowed', ...meta })
  return json({ integration: { ...integration, config: integration.config ? '[configured]' : null } }, 201)
}