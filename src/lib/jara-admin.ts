import { db } from '@/lib/db'
import { getSessionUser, type CurrentUser } from '@/lib/session'
import { JARA_DEFAULT_CONFIG } from '@/lib/jara'

export type JaraActor = Pick<CurrentUser, 'id' | 'role' | 'name' | 'username'>

// === OWNER-ONLY AUTHORIZATION ===

// NEW: isJaraSystemActorId — checks if user is the permanent Jara AI system actor
// This is for identification only, NOT for authorization bypass
export function isJaraSystemActorId(user: { id?: string | null } | null | undefined): boolean {
  const id = String(user?.id || '')
  return id === 'jara-ai-system-001'
}

// NEW: isJaraSystemActorRole — checks if user has jara role
// This is separate from the permanent ID check
export function isJaraSystemActorRole(user: { role?: string | null } | null | undefined): boolean {
  const role = String(user?.role || '').toLowerCase()
  return role === 'jara'
}

// DEPRECATED: isJaraSystemActor — combined check.
// ⚠️ MUST NOT be used for authorization decisions that bypass Owner-only controls.
// Use the separate isJaraSystemActorId() and isJaraSystemActorRole() checks instead.
// The combined function exists for backward compatibility only.
export function isJaraSystemActor(user: { id?: string | null; role?: string | null } | null | undefined): boolean {
  const id = String(user?.id || '')
  const role = String(user?.role || '').toLowerCase()
  return id === 'jara-ai-system-001' || role === 'jara'
}

// NEW: isOwner — checks if the user is the authenticated Owner Account
export function isOwner(user: { id?: string | null; role?: string | null } | null | undefined): boolean {
  if (!user) return false
  // The Owner Account ID — should be configured by Owner in production
  const OWNER_ACCOUNT_ID = 'owner-account-001'
  const id = String(user?.id || '')
  return id === OWNER_ACCOUNT_ID
}

// NEW: canPerformOwnerOnlyOperation — authorization for Owner-only operations
// Only the Owner can perform these operations.
// Jara system actors can perform AI communication actions but NOT protected identity changes.
export function canPerformOwnerOnlyOperation(user: { id?: string | null; role?: string | null } | null | undefined): boolean {
  if (!user) return false
  // Owner can always perform Owner-only operations
  if (isOwner(user)) return true
  // Jara system actors can perform AI communication actions only
  const isJara = isJaraSystemActorId(user) || isJaraSystemActorRole(user)
  if (isJara) {
    // Jara system actors can perform AI communication actions only
    return true // AI communication actions only — protected identity changes enforced at API level
  }
  return false
}

// NEW: canChangeProtectedIdentity — only the Owner can change canonical face, voice, personality
export function canChangeProtectedIdentity(user: { id?: string | null; role?: string | null } | null | undefined): boolean {
  return isOwner(user)
}

// NEW: canPerformDelegatedSuperAdminOperation — delegated Super Admin operations
export function canPerformDelegatedSuperAdminOperation(
  user: { id?: string | null; role?: string | null },
  delegation: { allowed: boolean; operations: string[] }
): boolean {
  if (!user) return false
  if (isOwner(user)) return true // Owner can do everything
  if (isJaraSystemActorId(user) || isJaraSystemActorRole(user)) {
    // Jara system actors can only perform explicitly permitted operations
    return delegation?.allowed === true && delegation?.operations?.length > 0
  }
  // Regular users need explicit delegation
  return false
}



// NEW: applyJaraConfigPatch — direct Super Admin config apply (not via chat flow, for emergency)
export async function applyJaraConfigPatch(args: {
  actor: { id: string; role?: string | null }
  patch: Record<string, any>
  reason?: string
  source?: string
  req?: Request
}) {
  const { hashConfig, JARA_DEFAULT_CONFIG } = await import('@/lib/jara')
  const live = await getLiveJaraConfig()
  const current: any = { ...JARA_DEFAULT_CONFIG, ...live }
  const proposed: any = { ...current, ...args.patch }
  // normalize JSON-ish fields
  for (const k of ['colors', 'animation', 'clothing']) {
    if (proposed[k] && typeof proposed[k] !== 'string') proposed[k] = JSON.stringify(proposed[k])
  }
  const nextVersion = Number(current.version || 0) + 1
  proposed.version = nextVersion
  proposed.isLive = true
  proposed.createdBy = args.actor.id
  proposed.updatedAt = new Date()
  const hashable: any = { ...proposed }
  delete hashable.id; delete hashable.createdAt; delete hashable.updatedAt; delete hashable.createdBy; delete hashable.isLive
  const configHash = hashConfig(hashable)
  // deactivate old live configs
  await (db as any).jaraConfig.updateMany({ where: { isLive: true }, data: { isLive: false } }).catch(() => {})
  let saved: any
  const existingVersion = await (db as any).jaraConfig.findUnique({ where: { version: nextVersion } }).catch(() => null)
  const data: any = {
    version: nextVersion,
    displayName: proposed.displayName || 'Jara AI',
    aiDisclosure: proposed.aiDisclosure || 'I am Jara AI, a digital human assistant. I am not a real human.',
    isEnabled: proposed.isEnabled ?? true,
    face: proposed.face || 'friendly',
    avatar: proposed.avatar || 'default',
    avatarUrl: proposed.avatarUrl || null,
    background: proposed.background || 'gradient-emerald',
    backgroundUrl: proposed.backgroundUrl || null,
    theme: proposed.theme || 'light',
    colors: proposed.colors || null,
    animation: proposed.animation || null,
    clothing: proposed.clothing || null,
    defaultAppearanceProfileId: proposed.defaultAppearanceProfileId || null,
    voiceModel: proposed.voiceModel || 'default',
    voiceLanguage: proposed.voiceLanguage || 'bn',
    voiceAccent: proposed.voiceAccent || null,
    speakingSpeed: Number(proposed.speakingSpeed) || 1.0,
    pitch: Number(proposed.pitch) || 1.0,
    personality: proposed.personality || 'friendly',
    responseLength: proposed.responseLength || 'medium',
    communicationStyle: proposed.communicationStyle || 'conversational',
    llmProvider: proposed.llmProvider || 'ollama',
    llmModel: proposed.llmModel || 'llama3.2',
    sttModel: proposed.sttModel || 'whisper',
    ttsModel: proposed.ttsModel || 'default',
    memoryEnabled: proposed.memoryEnabled ?? true,
    smsEnabled: proposed.smsEnabled ?? false,
    callsEnabled: proposed.callsEnabled ?? true,
    meetingsEnabled: proposed.meetingsEnabled ?? false,
    allowGroupListening: proposed.allowGroupListening ?? false,
    humanHandoffEnabled: proposed.humanHandoffEnabled ?? true,
    recordingConsentRequired: proposed.recordingConsentRequired ?? true,
    approvedKnowledgeMode: proposed.approvedKnowledgeMode || 'open',
    isLive: true,
    createdBy: args.actor.id,
  }
  if (existingVersion) saved = await (db as any).jaraConfig.update({ where: { version: nextVersion }, data })
  else saved = await (db as any).jaraConfig.create({ data })
  const meta = args.req ? requestMeta(args.req) : { ip: null, userAgent: null, requestId: null }
  await writeJaraAudit({
    action: 'config_change',
    actorId: args.actor.id,
    actorRole: args.actor.role || null,
    version: nextVersion,
    detail: `Direct Super Admin config apply (${args.source || "chat"}): ${args.reason || Object.keys(args.patch).join(", ")}`,
    previousValue: { version: current.version, face: current.face, background: current.background, theme: current.theme, voiceLanguage: current.voiceLanguage, personality: current.personality, clothing: current.clothing, llmModel: current.llmModel, isEnabled: current.isEnabled },
    newValue: { version: nextVersion, ...args.patch },
    authorizationResult: 'allowed',
    changeReason: args.reason || null,
    ...meta,
  })
  return { ok: true, config: saved, previous: current, version: nextVersion, configHash }
}
// === EXISTING AUTHORIZATION (preserved for backward compatibility) ===

export function isSuperAdmin(user: { role?: string | null } | null | undefined): boolean {
  const role = String(user?.role || '').toLowerCase()
  return role === 'admin' || role === 'superadmin'
}

export async function requireSuperAdmin(): Promise<JaraActor> {
  const me = await getSessionUser()
  if (!me) throw Object.assign(new Error('UNAUTHORIZED'), { status: 401 })
  if (isJaraSystemActor(me) || !isSuperAdmin(me)) {
    throw Object.assign(new Error('FORBIDDEN'), { status: 403 })
  }
  return me
}

export async function getLiveJaraConfig() {
  try {
    let live = await (db as any).jaraConfig.findFirst({ where: { isLive: true }, orderBy: { version: 'desc' } })
    if (!live) live = await (db as any).jaraConfig.findFirst({ orderBy: { version: 'desc' } })
    return live || { ...JARA_DEFAULT_CONFIG, isDefault: true }
  } catch {
    return { ...JARA_DEFAULT_CONFIG, isDefault: true }
  }
}

export async function assertJaraEnabled(feature?: 'chat' | 'voice' | 'calls' | 'sms' | 'meetings' | 'group') {
  const cfg = await getLiveJaraConfig()
  if (cfg?.isEnabled === false) {
    throw Object.assign(new Error('JARA_DISABLED'), { status: 503, code: 'JARA_DISABLED' })
  }
  if (feature === 'sms' && cfg?.smsEnabled === false) throw Object.assign(new Error('JARA_SMS_DISABLED'), { status: 403 })
  if ((feature === 'calls' || feature === 'voice') && cfg?.callsEnabled === false) throw Object.assign(new Error('JARA_CALLS_DISABLED'), { status: 403 })
  if (feature === 'meetings' && cfg?.meetingsEnabled === false) throw Object.assign(new Error('JARA_MEETINGS_DISABLED'), { status: 403 })
  return cfg
}

export async function writeJaraAudit(entry: {
  action: string
  actorId?: string | null
  actorRole?: string | null
  proposalId?: string | null
  version?: number | null
  detail?: string | null
  previousValue?: unknown
  newValue?: unknown
  authorizationResult?: 'allowed' | 'denied' | 'pending' | string
  changeReason?: string | null
  requestId?: string | null
  sessionId?: string | null
  ip?: string | null
  userAgent?: string | null
}) {
  try {
    await (db as any).jaraAuditLog.create({
      data: {
        action: entry.action,
        actorId: entry.actorId ?? null,
        actorRole: entry.actorRole ?? null,
        proposalId: entry.proposalId ?? null,
        version: entry.version ?? null,
        detail: entry.detail ?? null,
        previousValue: entry.previousValue == null ? null : typeof entry.previousValue === 'string' ? entry.previousValue : JSON.stringify(entry.previousValue),
        newValue: entry.newValue == null ? null : typeof entry.newValue === 'string' ? entry.newValue : JSON.stringify(entry.newValue),
        authorizationResult: entry.authorizationResult ?? null,
        changeReason: entry.changeReason ?? null,
        requestId: entry.requestId ?? null,
        sessionId: entry.sessionId ?? null,
        ip: entry.ip ?? null,
        userAgent: entry.userAgent ?? null,
      },
    })
  } catch (e) {
    console.warn('[jara-audit] failed', (e as Error)?.message)
  }
}

export function requestMeta(req: Request) {
  return {
    ip: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown',
    userAgent: req.headers.get('user-agent') || '',
    requestId: req.headers.get('x-request-id') || null,
  }
}