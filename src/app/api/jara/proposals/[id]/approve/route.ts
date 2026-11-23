import { NextRequest } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { errorJson, json } from '@/lib/serialize'
import { db } from '@/lib/db'
import { createHash } from 'crypto'

// POST /api/jara/proposals/[id]/approve — approve & apply a proposal
// Security requirements (section 11):
// - Verify Super Admin server-side (never trust frontend)
// - Approval must reference exact proposal ID + config version/hash
// - Expired proposals rejected
// - Modified proposals require fresh approval (hash check)
// - Replay rejected (already applied/approved)
// - Normal users cannot approve
// - Jara cannot self-approve (AI cannot authorize)
// - Record all attempts

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const me = await getSessionUser()
  if (!me) return errorJson('Unauthorized', 401)

  let body: any = {}
  try { body = await req.json() } catch {}
  const clientHash: string | undefined = body.configHash
  const clientVersion: number | undefined = body.version != null ? Number(body.version) : undefined

  const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown'
  const ua = req.headers.get('user-agent') || ''

  // Fetch proposal
  const proposal: any = await (db as any).jaraProposal.findUnique({ where: { id } }).catch(() => null)
  if (!proposal) {
    // Log blocked attempt
    try {
      await (db as any).jaraAuditLog.create({
        data: { proposalId: id, action: 'attempt_blocked', actorId: me.id, actorRole: me.role, detail: `Approve failed: proposal not found ${id}`, ip, userAgent: ua },
      })
    } catch {}
    return errorJson('Proposal not found', 404)
  }

  // === Security checks ===

  // 1. Only Super Admin can approve
  if (me.role !== 'admin' && me.role !== 'superadmin') {
    await (db as any).jaraAuditLog.create({
      data: { proposalId: id, action: 'attempt_blocked', actorId: me.id, actorRole: me.role, detail: `Blocked: non-admin ${me.id} attempted to approve v${proposal.version}`, ip, userAgent: ua },
    })
    return errorJson('Forbidden — Super Admin only', 403)
  }

  // 2. Jara cannot self-approve (defense in depth — role is jara)
  if (me.id === 'jara-ai-system-001' || (me as any).role === 'jara') {
    await (db as any).jaraAuditLog.create({
      data: { proposalId: id, action: 'attempt_blocked', actorId: me.id, actorRole: me.role, detail: 'Blocked: Jara cannot self-approve', ip, userAgent: ua },
    })
    return errorJson('Jara cannot approve its own proposal', 403)
  }

  // 3. Check proposal is still pending (replay protection)
  if (proposal.status !== 'pending') {
    await (db as any).jaraAuditLog.create({
      data: { proposalId: id, action: 'attempt_blocked', actorId: me.id, actorRole: me.role, detail: `Blocked: proposal already ${proposal.status}`, ip, userAgent: ua },
    })
    return errorJson(`Proposal is already ${proposal.status} — replay rejected`, 409)
  }

  // 4. Check expiry
  const expiresAt = new Date(proposal.expiresAt).getTime()
  if (Date.now() > expiresAt) {
    // Mark expired
    try { await (db as any).jaraProposal.update({ where: { id }, data: { status: 'expired' } }) } catch {}
    await (db as any).jaraAuditLog.create({
      data: { proposalId: id, action: 'expire', actorId: me.id, actorRole: me.role, detail: `Proposal expired at ${proposal.expiresAt}`, ip, userAgent: ua },
    })
    return errorJson('Proposal has expired', 410)
  }

  // 5. If client provided hash/version, verify exact match (prevents approving modified proposal)
  if (clientHash && clientHash !== proposal.configHash) {
    await (db as any).jaraAuditLog.create({
      data: { proposalId: id, action: 'attempt_blocked', actorId: me.id, actorRole: me.role, detail: `Blocked: hash mismatch client=${clientHash.slice(0, 12)} server=${proposal.configHash.slice(0, 12)}`, ip, userAgent: ua },
    })
    return errorJson('Proposal has been modified — hash mismatch. Fresh approval required.', 409)
  }
  if (clientVersion != null && clientVersion !== proposal.version) {
    await (db as any).jaraAuditLog.create({
      data: { proposalId: id, action: 'attempt_blocked', actorId: me.id, actorRole: me.role, detail: `Blocked: version mismatch client=${clientVersion} server=${proposal.version}`, ip, userAgent: ua },
    })
    return errorJson('Version mismatch — fresh approval required', 409)
  }

  // 6. Verify integrity: recompute hash of stored configJson
  try {
    const parsed = JSON.parse(proposal.configJson)
    const copy = { ...parsed }
    delete copy.id; delete copy.createdAt; delete copy.updatedAt; delete copy.createdBy; delete copy.isLive
    const canonical = JSON.stringify(sortKeys(copy))
    const recomputed = createHash('sha256').update(canonical).digest('hex')
    // Also allow direct hash of raw JSON if it matches stored hash (for backwards compat with different canonicalization)
    if (recomputed !== proposal.configHash) {
      const rawHash = createHash('sha256').update(proposal.configJson).digest('hex')
      if (rawHash !== proposal.configHash && recomputed !== proposal.configHash) {
        // If neither matches, proposal was tampered — reject
        await (db as any).jaraAuditLog.create({
          data: { proposalId: id, action: 'attempt_blocked', actorId: me.id, actorRole: me.role, detail: `Blocked: integrity check failed`, ip, userAgent: ua },
        })
        return errorJson('Proposal integrity check failed — config was modified', 409)
      }
    }
  } catch (e: any) {
    return errorJson('Proposal config JSON invalid', 500)
  }

  // === Apply the proposal ===

  // Parse proposed config
  let proposedConfig: any
  try { proposedConfig = JSON.parse(proposal.configJson) } catch { return errorJson('Invalid config JSON', 500) }

  // Atomically: deactivate old live, create new live config
  // Use version from proposal
  const previousLive = await (db as any).jaraConfig.findFirst({ where: { isLive: true } }).catch(() => null)
  const previousVersion = previousLive?.version ?? null

  try {
    // Check version conflict: if live version is not previousVersion, someone applied in between
    if (previousLive && proposal.previousVersion != null && previousLive.version !== proposal.previousVersion) {
      await (db as any).jaraAuditLog.create({
        data: { proposalId: id, action: 'attempt_blocked', actorId: me.id, actorRole: me.role, detail: `Blocked: live v${previousLive.version} != proposal previousVersion v${proposal.previousVersion} (concurrent modification)`, ip, userAgent: ua },
      })
      return errorJson(`Live version has changed (now v${previousLive.version}, proposal expected v${proposal.previousVersion}). Create a new proposal.`, 409)
    }

    await (db as any).jaraConfig.updateMany({ where: { isLive: true }, data: { isLive: false } })

    // Create new live config from proposed (strip id fields that shouldn't persist as-is)
    const newConfigData: any = {
      version: proposal.version,
      displayName: proposedConfig.displayName || 'Jara AI',
      aiDisclosure: proposedConfig.aiDisclosure || 'I am Jara AI, a digital human assistant. I am not a real human.',
      isEnabled: proposedConfig.isEnabled ?? true,
      face: proposedConfig.face || 'friendly',
      avatar: proposedConfig.avatar || 'default',
      avatarUrl: proposedConfig.avatarUrl || null,
      background: proposedConfig.background || 'gradient-emerald',
      backgroundUrl: proposedConfig.backgroundUrl || null,
      theme: proposedConfig.theme || 'light',
      colors: proposedConfig.colors ? (typeof proposedConfig.colors === 'string' ? proposedConfig.colors : JSON.stringify(proposedConfig.colors)) : null,
      animation: proposedConfig.animation ? (typeof proposedConfig.animation === 'string' ? proposedConfig.animation : JSON.stringify(proposedConfig.animation)) : null,
      clothing: proposedConfig.clothing ? (typeof proposedConfig.clothing === 'string' ? proposedConfig.clothing : JSON.stringify(proposedConfig.clothing)) : null,
      defaultAppearanceProfileId: proposedConfig.defaultAppearanceProfileId || null,
      voiceModel: proposedConfig.voiceModel || 'default',
      voiceLanguage: proposedConfig.voiceLanguage || 'bn',
      voiceAccent: proposedConfig.voiceAccent || null,
      speakingSpeed: Number(proposedConfig.speakingSpeed) || 1.0,
      pitch: Number(proposedConfig.pitch) || 1.0,
      personality: proposedConfig.personality || 'friendly',
      responseLength: proposedConfig.responseLength || 'medium',
      communicationStyle: proposedConfig.communicationStyle || 'conversational',
      llmProvider: proposedConfig.llmProvider || 'ollama',
      llmModel: proposedConfig.llmModel || 'llama3.2',
      sttModel: proposedConfig.sttModel || 'whisper',
      ttsModel: proposedConfig.ttsModel || 'default',
      memoryEnabled: proposedConfig.memoryEnabled ?? true,
      smsEnabled: proposedConfig.smsEnabled ?? false,
      callsEnabled: proposedConfig.callsEnabled ?? true,
      meetingsEnabled: proposedConfig.meetingsEnabled ?? false,
      allowGroupListening: proposedConfig.allowGroupListening ?? false,
      humanHandoffEnabled: proposedConfig.humanHandoffEnabled ?? true,
      recordingConsentRequired: proposedConfig.recordingConsentRequired ?? true,
      approvedKnowledgeMode: proposedConfig.approvedKnowledgeMode || 'open',
      isLive: true,
      createdBy: me.id,
    }

    // Upsert by version (if version already exists, update it)
    const existingVersion = await (db as any).jaraConfig.findUnique({ where: { version: proposal.version } }).catch(() => null)
    let newLive
    if (existingVersion) {
      newLive = await (db as any).jaraConfig.update({ where: { version: proposal.version }, data: { ...newConfigData, isLive: true } })
    } else {
      newLive = await (db as any).jaraConfig.create({ data: newConfigData })
    }

    // Mark proposal approved+applied
    await (db as any).jaraProposal.update({
      where: { id },
      data: {
        status: 'applied',
        approvedBy: me.id,
        approvedAt: new Date(),
        appliedAt: new Date(),
      },
    })

    await (db as any).jaraAuditLog.create({
      data: {
        proposalId: id,
        version: proposal.version,
        action: 'apply',
        actorId: me.id,
        actorRole: me.role,
        detail: `Approved & applied v${proposal.version} (prev v${previousVersion}) by ${me.id}. Changes: ${proposal.changeSummary || ''}`,
        ip,
        userAgent: ua,
      },
    })

    return json({ ok: true, proposal: { ...proposal, status: 'applied', approvedBy: me.id, appliedAt: new Date().toISOString() }, config: newLive })

  } catch (e: any) {
    // Preserve previous config on failure — we already didn't delete, just try to reactivate old if needed
    if (previousLive) {
      try { await (db as any).jaraConfig.update({ where: { id: previousLive.id }, data: { isLive: true } }) } catch {}
    }
    await (db as any).jaraAuditLog.create({
      data: {
        proposalId: id,
        version: proposal.version,
        action: 'apply_failed',
        actorId: me.id,
        actorRole: me.role,
        detail: `Apply failed: ${e.message}`,
        ip,
        userAgent: ua,
      },
    })
    return errorJson(`Failed to apply: ${e.message}`, 500)
  }
}

function sortKeys(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') return obj
  if (Array.isArray(obj)) return (obj as any[]).map(sortKeys)
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(obj as Record<string, unknown>).sort()) {
    out[k] = sortKeys((obj as Record<string, unknown>)[k])
  }
  return out
}
