import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { errorJson, json } from '@/lib/serialize'
import { requireSuperAdmin, writeJaraAudit, requestMeta } from '@/lib/jara-admin'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let me
  try { me = await requireSuperAdmin() } catch (e: any) { return errorJson(e.message === 'UNAUTHORIZED' ? 'Unauthorized' : 'Forbidden — Super Admin only', e.status || 403) }
  const { id } = await params
  let body: any
  try { body = await req.json() } catch { return errorJson('Invalid JSON', 400) }
  const existing = await (db as any).jaraAsset.findUnique({ where: { id } }).catch(() => null)
  if (!existing) return errorJson('Asset not found', 404)
  const action = String(body.action || 'update')
  const data: any = { updatedBy: me.id }
  if (action === 'approve') { data.status = 'approved'; data.isApproved = true; data.approvedBy = me.id; data.approvedAt = new Date() }
  else if (action === 'reject') { data.status = 'rejected'; data.isApproved = false }
  else if (action === 'archive') { data.status = 'archived'; data.isApproved = false }
  else {
    if (body.name) data.name = String(body.name).slice(0, 160)
    if (body.description !== undefined) data.description = body.description ? String(body.description).slice(0, 500) : null
    if (body.kind) data.kind = String(body.kind).slice(0, 40)
  }
  const asset = await (db as any).jaraAsset.update({ where: { id }, data })
  await writeJaraAudit({ action: 'config_change', actorId: me.id, actorRole: me.role, detail: `Jara asset ${action}: ${asset.name}`, previousValue: { status: existing.status }, newValue: { status: asset.status, action }, authorizationResult: 'allowed', ...requestMeta(req) })
  return json({ asset })
}