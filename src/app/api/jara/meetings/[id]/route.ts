import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { errorJson, json } from '@/lib/serialize'
import { requireSuperAdmin, writeJaraAudit, requestMeta } from '@/lib/jara-admin'
import { getRendererCapability } from '@/lib/jara-renderer'

function asString(v: any, max = 500) { return v == null ? null : String(v).slice(0, max) }

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireSuperAdmin() } catch (e: any) { return errorJson(e.message === 'UNAUTHORIZED' ? 'Unauthorized' : 'Forbidden — Super Admin only', e.status || 403) }
  const { id } = await params
  const meeting = await (db as any).jaraMeetingProfile.findUnique({ where: { id } }).catch(() => null)
  if (!meeting) return errorJson('Meeting not found', 404)
  return json({ meeting, renderer: getRendererCapability() })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let me
  try { me = await requireSuperAdmin() } catch (e: any) { return errorJson(e.message === 'UNAUTHORIZED' ? 'Unauthorized' : 'Forbidden — Super Admin only', e.status || 403) }
  const { id } = await params
  let body: any
  try { body = await req.json() } catch { return errorJson('Invalid JSON', 400) }
  const existing = await (db as any).jaraMeetingProfile.findUnique({ where: { id } }).catch(() => null)
  if (!existing) return errorJson('Meeting not found', 404)

  const action = String(body.action || 'update')
  const data: any = { updatedBy: me.id, rendererStatus: getRendererCapability().mode }

  if (action === 'approve') {
    data.status = 'approved'
    data.approvedBy = me.id
    data.approvedAt = new Date()
    data.configSnapshot = JSON.stringify({ ...existing, ...body, approvedAt: new Date().toISOString() })
  } else if (action === 'schedule') {
    data.status = 'scheduled'
    if (body.scheduledAt) data.scheduledAt = new Date(body.scheduledAt)
  } else if (action === 'cancel') {
    data.status = 'cancelled'
    data.cancelledAt = new Date()
  } else if (action === 'start') {
    const cap = getRendererCapability()
    data.status = 'active'
    data.startedAt = new Date()
    data.configSnapshot = existing.configSnapshot || JSON.stringify({ ...existing, ...body })
    // Create a meeting-specific presentation reservation (fallback unless real renderer configured)
    await (db as any).jaraCallPresentation.create({ data: {
      sessionType: 'meeting', sessionId: `meeting:${id}`, roomId: null, profileId: existing.appearanceProfileId || null,
      profileSnapshot: JSON.stringify({ ...existing, ...body, background: body.background ?? existing.background, clothing: body.clothing ?? existing.clothing, voiceLanguage: body.voiceLanguage ?? existing.voiceLanguage }),
      isTemporary: true, expiresAt: body.expiresAt ? new Date(body.expiresAt) : null, status: 'applied', createdBy: me.id,
    } }).catch(() => {})
  } else if (action === 'complete') {
    data.status = 'completed'
    data.endedAt = new Date()
  } else {
    // normal update
    for (const k of ['title','purpose','meetingType','platform','background','backgroundUrl','avatarStyle','presentationStyle','voiceLanguage','voiceProfile','speakingStyle','script','instructions','referenceImageAssetId','referenceVideoAssetId','voiceSampleAssetId','referenceImageUrl','referenceVideoUrl','voiceSampleUrl','scope']) {
      if (body[k] !== undefined) data[k] = asString(body[k], k === 'script' || k === 'instructions' ? 10000 : 1000)
    }
    if (body.scheduledAt !== undefined) data.scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : null
    if (body.durationMinutes !== undefined) data.durationMinutes = body.durationMinutes == null ? null : Number(body.durationMinutes)
    if (body.participants !== undefined) data.participants = body.participants ? (typeof body.participants === 'string' ? body.participants : JSON.stringify(body.participants)) : null
    if (body.clothing !== undefined) data.clothing = body.clothing ? (typeof body.clothing === 'string' ? body.clothing : JSON.stringify(body.clothing)) : null
    if (body.talkingPoints !== undefined) data.talkingPoints = body.talkingPoints ? (typeof body.talkingPoints === 'string' ? body.talkingPoints : JSON.stringify(body.talkingPoints)) : null
    if (body.appearanceProfileId !== undefined) data.appearanceProfileId = asString(body.appearanceProfileId, 120)
  }

  const meeting = await (db as any).jaraMeetingProfile.update({ where: { id }, data })
  const meta = requestMeta(req)
  await writeJaraAudit({ action: 'config_change', actorId: me.id, actorRole: me.role, detail: `Meeting profile ${action}: ${meeting.title} (${meeting.status})`, previousValue: { status: existing.status }, newValue: { status: meeting.status, action }, authorizationResult: 'allowed', ...meta })
  return json({ meeting, renderer: getRendererCapability() })
}