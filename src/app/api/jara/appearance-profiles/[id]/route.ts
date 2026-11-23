import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { errorJson, json } from '@/lib/serialize'
import { requireSuperAdmin, writeJaraAudit, requestMeta } from '@/lib/jara-admin'

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let me
  try { me = await requireSuperAdmin() } catch (e: any) { return errorJson(e.message === 'UNAUTHORIZED' ? 'Unauthorized' : 'Forbidden — Super Admin only', e.status || 403) }
  let body: any
  try { body = await req.json() } catch { return errorJson('Invalid JSON', 400) }
  const existing = await (db as any).jaraAppearanceProfile.findUnique({ where: { id } }).catch(() => null)
  if (!existing) return errorJson('Profile not found', 404)

  const data: any = {}
  for (const k of ['name','description','profileType','face','avatar','avatarUrl','background','backgroundUrl','theme','colors','clothing','animation','voiceModel','voiceLanguage','personality','communicationStyle']) {
    if (body[k] !== undefined) data[k] = body[k] == null ? null : String(body[k]).slice(0, k.includes('Url') ? 1000 : 500)
  }
  for (const k of ['isDefault','isTemporary','isActive']) if (body[k] !== undefined) data[k] = Boolean(body[k])
  for (const k of ['speakingSpeed','pitch']) if (body[k] !== undefined) data[k] = body[k] == null ? null : Number(body[k])
  if (body.expiresAt !== undefined) data.expiresAt = body.expiresAt ? new Date(body.expiresAt) : null
  data.updatedBy = me.id

  if (data.isDefault) await (db as any).jaraAppearanceProfile.updateMany({ where: { isDefault: true, NOT: { id } }, data: { isDefault: false } }).catch(() => {})
  const profile = await (db as any).jaraAppearanceProfile.update({ where: { id }, data })
  const meta = requestMeta(req)
  await writeJaraAudit({ action: 'config_change', actorId: me.id, actorRole: me.role, detail: `Updated appearance profile ${profile.name}`, previousValue: existing, newValue: profile, authorizationResult: 'allowed', changeReason: body.reason || null, ...meta })
  return json({ profile })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let me
  try { me = await requireSuperAdmin() } catch (e: any) { return errorJson(e.message === 'UNAUTHORIZED' ? 'Unauthorized' : 'Forbidden — Super Admin only', e.status || 403) }
  const existing = await (db as any).jaraAppearanceProfile.findUnique({ where: { id } }).catch(() => null)
  if (!existing) return errorJson('Profile not found', 404)
  await (db as any).jaraAppearanceProfile.delete({ where: { id } })
  const meta = requestMeta(req)
  await writeJaraAudit({ action: 'config_change', actorId: me.id, actorRole: me.role, detail: `Deleted appearance profile ${existing.name}`, previousValue: existing, authorizationResult: 'allowed', ...meta })
  return json({ ok: true })
}