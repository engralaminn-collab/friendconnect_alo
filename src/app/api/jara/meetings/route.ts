import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { errorJson, json } from '@/lib/serialize'
import { requireSuperAdmin, writeJaraAudit, requestMeta } from '@/lib/jara-admin'
import { getRendererCapability } from '@/lib/jara-renderer'

function asString(v: any, max = 500) { return v == null ? null : String(v).slice(0, max) }
function asInt(v: any) { const n = Number(v); return Number.isFinite(n) ? n : null }

export async function GET(req: NextRequest) {
  try { await requireSuperAdmin() } catch (e: any) { return errorJson(e.message === 'UNAUTHORIZED' ? 'Unauthorized' : 'Forbidden — Super Admin only', e.status || 403) }
  const status = req.nextUrl.searchParams.get('status')
  const where: any = {}
  if (status) where.status = status
  const meetings = await (db as any).jaraMeetingProfile.findMany({ where, orderBy: { createdAt: 'desc' }, take: 100 }).catch(() => [])
  return json({ meetings, renderer: getRendererCapability() })
}

export async function POST(req: NextRequest) {
  let me
  try { me = await requireSuperAdmin() } catch (e: any) { return errorJson(e.message === 'UNAUTHORIZED' ? 'Unauthorized' : 'Forbidden — Super Admin only', e.status || 403) }
  let body: any
  try { body = await req.json() } catch { return errorJson('Invalid JSON', 400) }
  const title = String(body.title || '').trim().slice(0, 200)
  if (!title) return errorJson('title required', 400)

  const meeting = await (db as any).jaraMeetingProfile.create({ data: {
    title,
    purpose: asString(body.purpose, 1000),
    meetingType: asString(body.meetingType, 60) || 'custom_video_call',
    scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : null,
    durationMinutes: asInt(body.durationMinutes),
    platform: asString(body.platform, 40) || 'internal',
    participants: body.participants ? (typeof body.participants === 'string' ? body.participants : JSON.stringify(body.participants)) : null,
    appearanceProfileId: asString(body.appearanceProfileId, 120),
    clothing: body.clothing ? (typeof body.clothing === 'string' ? body.clothing : JSON.stringify(body.clothing)) : null,
    background: asString(body.background, 120),
    backgroundUrl: asString(body.backgroundUrl, 1000),
    avatarStyle: asString(body.avatarStyle, 80),
    presentationStyle: asString(body.presentationStyle, 80),
    voiceLanguage: asString(body.voiceLanguage, 16),
    voiceProfile: asString(body.voiceProfile, 80),
    speakingStyle: asString(body.speakingStyle, 80),
    script: asString(body.script, 10000),
    talkingPoints: body.talkingPoints ? (typeof body.talkingPoints === 'string' ? body.talkingPoints : JSON.stringify(body.talkingPoints)) : null,
    instructions: asString(body.instructions, 5000),
    referenceImageAssetId: asString(body.referenceImageAssetId, 120),
    referenceVideoAssetId: asString(body.referenceVideoAssetId, 120),
    voiceSampleAssetId: asString(body.voiceSampleAssetId, 120),
    referenceImageUrl: asString(body.referenceImageUrl, 1000),
    referenceVideoUrl: asString(body.referenceVideoUrl, 1000),
    voiceSampleUrl: asString(body.voiceSampleUrl, 1000),
    status: 'draft',
    scope: asString(body.scope, 40) || 'meeting_specific',
    rendererStatus: getRendererCapability().mode,
    createdBy: me.id,
    updatedBy: me.id,
  } })

  const meta = requestMeta(req)
  await writeJaraAudit({ action: 'config_change', actorId: me.id, actorRole: me.role, detail: `Created meeting profile ${meeting.title}`, newValue: { id: meeting.id, title: meeting.title, status: meeting.status }, authorizationResult: 'allowed', ...meta })
  return json({ meeting, renderer: getRendererCapability() }, 201)
}