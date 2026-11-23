import { NextRequest } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { errorJson, json } from '@/lib/serialize'
import { db } from '@/lib/db'
import { getLiveJaraConfig } from '@/lib/jara-admin'
import { getRendererCapability } from '@/lib/jara-renderer'
import { getVoiceCapability } from '@/lib/jara-voice'

export async function GET(_req: NextRequest) {
  const me = await getSessionUser()
  if (!me) return errorJson('Unauthorized', 401)
  const cfg = await getLiveJaraConfig()
  const [activeTemp, pendingTemp] = await Promise.all([
    (db as any).jaraCallPresentation.findFirst({ where: { status: 'applied', isTemporary: true }, orderBy: { createdAt: 'desc' }, include: { profile: true } }).catch(() => null),
    (db as any).jaraCallPresentation.findFirst({ where: { status: 'active', isTemporary: true, sessionId: null }, orderBy: { createdAt: 'desc' }, include: { profile: true } }).catch(() => null),
  ])
  return json({
    config: {
      version: cfg?.version,
      isEnabled: cfg?.isEnabled !== false,
      displayName: cfg?.displayName || 'Jara AI',
      background: cfg?.background,
      clothing: cfg?.clothing,
      voiceLanguage: cfg?.voiceLanguage,
      voiceModel: cfg?.voiceModel,
      personality: cfg?.personality,
      communicationStyle: cfg?.communicationStyle,
    },
    temporary: {
      pendingNextCall: pendingTemp ? { id: pendingTemp.id, profileId: pendingTemp.profileId, expiresAt: pendingTemp.expiresAt, profile: pendingTemp.profile } : null,
      active: activeTemp ? { id: activeTemp.id, sessionId: activeTemp.sessionId, profileId: activeTemp.profileId, profile: activeTemp.profile } : null,
    },
    renderer: getRendererCapability(),
    voice: getVoiceCapability(),
  })
}