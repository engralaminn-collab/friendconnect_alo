import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { errorJson, json } from '@/lib/serialize'
import { requireSuperAdmin, writeJaraAudit, requestMeta } from '@/lib/jara-admin'

function cleanProfileInput(body: any) {
  const name = String(body.name || '').trim()
  if (!name) throw Object.assign(new Error('name required'), { status: 400 })
  return {
    name: name.slice(0, 120),
    description: body.description ? String(body.description).slice(0, 500) : null,
    profileType: String(body.profileType || 'custom').slice(0, 40),
    isDefault: Boolean(body.isDefault),
    isTemporary: Boolean(body.isTemporary),
    expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
    face: String(body.face || 'friendly').slice(0, 40),
    avatar: String(body.avatar || 'default').slice(0, 40),
    avatarUrl: body.avatarUrl ? String(body.avatarUrl).slice(0, 1000) : null,
    background: String(body.background || 'gradient-emerald').slice(0, 80),
    backgroundUrl: body.backgroundUrl ? String(body.backgroundUrl).slice(0, 1000) : null,
    theme: String(body.theme || 'light').slice(0, 40),
    colors: body.colors ? (typeof body.colors === 'string' ? body.colors : JSON.stringify(body.colors)) : null,
    clothing: body.clothing ? (typeof body.clothing === 'string' ? body.clothing : JSON.stringify(body.clothing)) : null,
    animation: body.animation ? (typeof body.animation === 'string' ? body.animation : JSON.stringify(body.animation)) : null,
    voiceModel: body.voiceModel ? String(body.voiceModel).slice(0, 80) : null,
    voiceLanguage: body.voiceLanguage ? String(body.voiceLanguage).slice(0, 16) : null,
    speakingSpeed: body.speakingSpeed != null ? Number(body.speakingSpeed) : null,
    pitch: body.pitch != null ? Number(body.pitch) : null,
    personality: body.personality ? String(body.personality).slice(0, 60) : null,
    communicationStyle: body.communicationStyle ? String(body.communicationStyle).slice(0, 60) : null,
    isActive: body.isActive !== false,
  }
}

export async function GET() {
  try { await requireSuperAdmin() } catch (e: any) { return errorJson(e.message === 'UNAUTHORIZED' ? 'Unauthorized' : 'Forbidden — Super Admin only', e.status || 403) }
  const profiles = await (db as any).jaraAppearanceProfile.findMany({ orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }] }).catch(() => [])
  return json({ profiles })
}

export async function POST(req: NextRequest) {
  let me
  try { me = await requireSuperAdmin() } catch (e: any) { return errorJson(e.message === 'UNAUTHORIZED' ? 'Unauthorized' : 'Forbidden — Super Admin only', e.status || 403) }
  let body: any
  try { body = await req.json() } catch { return errorJson('Invalid JSON', 400) }
  let data: any
  try { data = cleanProfileInput(body) } catch (e: any) { return errorJson(e.message, e.status || 400) }

  if (data.isDefault) await (db as any).jaraAppearanceProfile.updateMany({ where: { isDefault: true }, data: { isDefault: false } }).catch(() => {})
  const profile = await (db as any).jaraAppearanceProfile.create({ data: { ...data, createdBy: me.id, updatedBy: me.id } })
  const meta = requestMeta(req)
  await writeJaraAudit({ action: 'config_change', actorId: me.id, actorRole: me.role, detail: `Created appearance profile ${profile.name}`, newValue: profile, authorizationResult: 'allowed', changeReason: body.reason || null, ...meta })
  return json({ profile }, 201)
}