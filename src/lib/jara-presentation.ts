import { db } from '@/lib/db'
import { JARA_DEFAULT_CONFIG } from '@/lib/jara'

export type PresentationScope = 'default' | 'profile' | 'temporary_next_call' | 'temporary_session'

export interface ResolvedPresentation {
  sessionId: string
  sessionType: string
  scope: PresentationScope
  profileId: string | null
  callPresentationId: string | null
  configVersion: number
  identity: { displayName: string; aiDisclosure: string }
  appearance: {
    face: string
    avatar: string
    avatarUrl: string | null
    background: string
    backgroundUrl: string | null
    theme: string
    colors: string | null
    clothing: string | null
    animation: string | null
  }
  voice: { voiceModel: string; voiceLanguage: string; speakingSpeed: number; pitch: number }
  personality: { personality: string; communicationStyle: string; responseLength: string }
  temporary: boolean
  expiresAt: string | null
}

function safeJsonParse<T>(v: any, fallback: T): T {
  if (v == null) return fallback
  if (typeof v !== 'string') return v as T
  try { return JSON.parse(v) as T } catch { return fallback }
}

async function getLiveConfig() {
  const live = await (db as any).jaraConfig.findFirst({ where: { isLive: true }, orderBy: { version: 'desc' } }).catch(() => null)
  return live || { ...JARA_DEFAULT_CONFIG, isDefault: true }
}

function fromConfig(cfg: any, sessionId: string, sessionType: string): ResolvedPresentation {
  return {
    sessionId, sessionType, scope: 'default', profileId: null, callPresentationId: null,
    configVersion: Number(cfg?.version || 1),
    identity: { displayName: cfg?.displayName || 'Jara AI', aiDisclosure: cfg?.aiDisclosure || 'I am Jara AI, a digital human assistant. I am not a real human.' },
    appearance: {
      face: cfg?.face || 'friendly', avatar: cfg?.avatar || 'default', avatarUrl: cfg?.avatarUrl || null,
      background: cfg?.background || 'gradient-emerald', backgroundUrl: cfg?.backgroundUrl || null,
      theme: cfg?.theme || 'light', colors: cfg?.colors || null, clothing: cfg?.clothing || null, animation: cfg?.animation || null,
    },
    voice: { voiceModel: cfg?.voiceModel || 'default', voiceLanguage: cfg?.voiceLanguage || 'bn', speakingSpeed: Number(cfg?.speakingSpeed || 1), pitch: Number(cfg?.pitch || 1) },
    personality: { personality: cfg?.personality || 'friendly', communicationStyle: cfg?.communicationStyle || 'conversational', responseLength: cfg?.responseLength || 'medium' },
    temporary: false, expiresAt: null,
  }
}

function applyProfile(base: ResolvedPresentation, profile: any, callPresentation: any): ResolvedPresentation {
  const snap = safeJsonParse<any>(callPresentation?.profileSnapshot, null)
  const p = snap || profile || {}
  return {
    ...base,
    scope: callPresentation?.isTemporary ? 'temporary_session' : 'profile',
    profileId: profile?.id || callPresentation?.profileId || p?.id || null,
    callPresentationId: callPresentation?.id || null,
    appearance: {
      ...base.appearance,
      face: p.face || base.appearance.face,
      avatar: p.avatar || base.appearance.avatar,
      avatarUrl: p.avatarUrl ?? base.appearance.avatarUrl,
      background: p.background || base.appearance.background,
      backgroundUrl: p.backgroundUrl ?? base.appearance.backgroundUrl,
      theme: p.theme || base.appearance.theme,
      colors: p.colors ?? base.appearance.colors,
      clothing: p.clothing ?? base.appearance.clothing,
      animation: p.animation ?? base.appearance.animation,
    },
    voice: {
      ...base.voice,
      voiceModel: p.voiceModel || base.voice.voiceModel,
      voiceLanguage: p.voiceLanguage || base.voice.voiceLanguage,
      speakingSpeed: p.speakingSpeed != null ? Number(p.speakingSpeed) : base.voice.speakingSpeed,
      pitch: p.pitch != null ? Number(p.pitch) : base.voice.pitch,
    },
    personality: {
      ...base.personality,
      personality: p.personality || base.personality.personality,
      communicationStyle: p.communicationStyle || base.personality.communicationStyle,
    },
    temporary: Boolean(callPresentation?.isTemporary),
    expiresAt: callPresentation?.expiresAt ? new Date(callPresentation.expiresAt).toISOString() : null,
  }
}

async function expireIfNeeded(row: any) {
  if (row?.expiresAt && new Date(row.expiresAt).getTime() < Date.now() && ['active','reserved','applied'].includes(row.status)) {
    await (db as any).jaraCallPresentation.update({ where: { id: row.id }, data: { status: 'expired' } }).catch(() => {})
    return true
  }
  return false
}

export async function resolvePresentationForSession(args: { sessionId: string; sessionType: string; reserveNextCall?: boolean; actorId?: string | null }) {
  const cfg = await getLiveConfig()
  const base = fromConfig(cfg, args.sessionId, args.sessionType)

  // 1) Existing assignment for this exact session (session isolation)
  const existing = await (db as any).jaraCallPresentation.findFirst({
    where: { sessionId: args.sessionId, status: { in: ['active', 'reserved', 'applied'] } },
    orderBy: { createdAt: 'desc' },
    include: { profile: true },
  }).catch(() => null)
  if (existing) {
    if (await expireIfNeeded(existing)) {
      // fall through to default/profile resolution below
    } else {
      const resolved = applyProfile(base, existing.profile, existing)
      if (existing.status === 'active' || existing.status === 'reserved') {
        await (db as any).jaraCallPresentation.update({ where: { id: existing.id }, data: { status: 'applied' } }).catch(() => {})
      }
      return resolved
    }
  }

  // 2) Reserve next temporary next-call profile (sessionId null) for eligible session type
  if (args.reserveNextCall !== false) {
    const candidates = await (db as any).jaraCallPresentation.findMany({
      where: {
        sessionId: null,
        status: 'active',
        isTemporary: true,
        sessionType: { in: [args.sessionType, 'video_call', 'audio_call', 'meeting'] },
      },
      orderBy: { createdAt: 'asc' },
      take: 5,
      include: { profile: true },
    }).catch(() => [])

    for (const candidate of candidates) {
      if (await expireIfNeeded(candidate)) continue
      // Best-effort atomic claim: only claim if still unassigned/active
      const claimed = await (db as any).jaraCallPresentation.updateMany({
        where: { id: candidate.id, sessionId: null, status: 'active' },
        data: { sessionId: args.sessionId, status: 'applied', sessionType: args.sessionType },
      }).catch(() => null)
      if (claimed && Number(claimed.count || 0) > 0) {
        const fresh = await (db as any).jaraCallPresentation.findUnique({ where: { id: candidate.id }, include: { profile: true } }).catch(() => null)
        if (fresh) return applyProfile(base, fresh.profile, fresh)
      }
    }
  }

  // 3) Default appearance profile
  if (cfg?.defaultAppearanceProfileId) {
    const profile = await (db as any).jaraAppearanceProfile.findUnique({ where: { id: cfg.defaultAppearanceProfileId } }).catch(() => null)
    if (profile && profile.isActive !== false) {
      return applyProfile(base, profile, { isTemporary: false, profileId: profile.id, id: null, expiresAt: null })
    }
  }
  return base
}

export async function releasePresentationForSession(args: { sessionId: string; outcome: 'completed' | 'cancelled' | 'failed' | 'expired' }) {
  const rows = await (db as any).jaraCallPresentation.findMany({ where: { sessionId: args.sessionId, status: { in: ['active', 'reserved', 'applied'] } } }).catch(() => [])
  let count = 0
  for (const row of rows) {
    const status = row.isTemporary
      ? (args.outcome === 'completed' ? 'consumed' : args.outcome === 'cancelled' ? 'cancelled' : args.outcome === 'failed' ? 'failed' : 'expired')
      : (args.outcome === 'completed' ? 'completed' : args.outcome)
    const updated = await (db as any).jaraCallPresentation.updateMany({ where: { id: row.id, status: { in: ['active','reserved','applied'] } }, data: { status } }).catch(() => null)
    count += Number(updated?.count || 0)
  }
  return { ok: true, count }
}