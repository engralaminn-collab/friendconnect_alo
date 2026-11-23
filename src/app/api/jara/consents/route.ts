import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { errorJson, json } from '@/lib/serialize'
import { requireSuperAdmin, writeJaraAudit, requestMeta } from '@/lib/jara-admin'

export async function GET() {
  try { await requireSuperAdmin() } catch (e: any) { return errorJson(e.message === 'UNAUTHORIZED' ? 'Unauthorized' : 'Forbidden — Super Admin only', e.status || 403) }
  const consents = await (db as any).jaraConsentRecord.findMany({ orderBy: { createdAt: 'desc' }, take: 200 }).catch(() => [])
  return json({ consents })
}

export async function POST(req: NextRequest) {
  let me
  try { me = await requireSuperAdmin() } catch (e: any) { return errorJson(e.message === 'UNAUTHORIZED' ? 'Unauthorized' : 'Forbidden — Super Admin only', e.status || 403) }
  let body: any
  try { body = await req.json() } catch { return errorJson('Invalid JSON', 400) }
  const consent = await (db as any).jaraConsentRecord.create({ data: {
    subjectType: String(body.subjectType || 'user').slice(0, 40),
    subjectId: body.subjectId ? String(body.subjectId).slice(0, 120) : null,
    subjectLabel: body.subjectLabel ? String(body.subjectLabel).slice(0, 200) : null,
    consentType: String(body.consentType || 'data_processing').slice(0, 60),
    status: String(body.status || 'granted').slice(0, 30),
    source: body.source ? String(body.source).slice(0, 40) : 'admin',
    details: body.details ? String(body.details).slice(0, 2000) : null,
    grantedAt: body.status === 'revoked' ? null : new Date(),
    revokedAt: body.status === 'revoked' ? new Date() : null,
    recordedBy: me.id,
  } })
  const meta = requestMeta(req)
  await writeJaraAudit({ action: 'config_change', actorId: me.id, actorRole: me.role, detail: `Recorded consent ${consent.consentType} for ${consent.subjectType}`, newValue: consent, authorizationResult: 'allowed', ...meta })
  return json({ consent }, 201)
}