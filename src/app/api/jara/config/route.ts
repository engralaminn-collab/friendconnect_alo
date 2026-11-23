import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { errorJson, json } from '@/lib/serialize'

// GET /api/jara/config — current live configuration (public for preview, but sensitive fields filtered for non-admin)
export async function GET(req: NextRequest) {
  try {
    const me = await getSessionUser().catch(() => null)
    // Try live config, fallback to any latest
    let live = await (db as any).jaraConfig.findFirst({ where: { isLive: true }, orderBy: { version: 'desc' } }).catch(() => null)
    if (!live) live = await (db as any).jaraConfig.findFirst({ orderBy: { version: 'desc' } }).catch(() => null)
    if (!live) {
      // Fallback default without DB
      return json({
        config: {
          version: 1,
          displayName: 'Jara AI',
          aiDisclosure: 'I am Jara AI, a digital human assistant. I am not a real human.',
          isEnabled: true,
          face: 'friendly',
          avatar: 'default',
          background: 'gradient-emerald',
          theme: 'light',
          colors: JSON.stringify({ primary: '#10b981', accent: '#0ea5e9' }),
          voiceModel: 'default',
          voiceLanguage: 'bn',
          speakingSpeed: 1.0,
          pitch: 1.0,
          personality: 'friendly',
          responseLength: 'medium',
          communicationStyle: 'conversational',
          llmProvider: 'ollama',
          llmModel: 'llama3.2',
          sttModel: 'whisper',
          ttsModel: 'default',
          memoryEnabled: true,
          smsEnabled: false,
          callsEnabled: true,
          meetingsEnabled: false,
          allowGroupListening: false,
          humanHandoffEnabled: true,
          recordingConsentRequired: true,
          approvedKnowledgeMode: 'open',
          isLive: true,
        },
        isDefault: true,
      })
    }
    // For non-admin, filter sensitive AI credentials (none in this model, but keep pattern)
    return json({ config: live })
  } catch (e: any) {
    return errorJson(e?.message || 'Server error', 500)
  }
}

// POST /api/jara/config — admin-only direct update (not via chat flow, for Config Center emergency)
export async function PUT(req: NextRequest) {
  try {
    const me = await getSessionUser()
    if (!me) return errorJson('Unauthorized', 401)
    if (me.role !== 'admin' && me.role !== 'superadmin') return errorJson('Forbidden — Super Admin only', 403)

    const body = await req.json()
    // Only allow direct PUT for rollback emergency; normal flow is proposal->approve
    // Require explicit flag
    if (!body._emergencyRollback) {
      return errorJson('Use proposal workflow. Direct PUT requires _emergencyRollback flag (audited).', 400)
    }

    const targetVersion = Number(body.targetVersion)
    if (!targetVersion) return errorJson('targetVersion required', 400)

    const target = await (db as any).jaraConfig.findUnique({ where: { version: targetVersion } })
    if (!target) return errorJson('Version not found', 404)

    // Deactivate current live
    await (db as any).jaraConfig.updateMany({ where: { isLive: true }, data: { isLive: false } })
    await (db as any).jaraConfig.update({ where: { id: target.id }, data: { isLive: true } })

    await (db as any).jaraAuditLog.create({
      data: {
        action: 'rollback',
        actorId: me.id,
        actorRole: me.role,
        version: target.version,
        detail: `Emergency rollback to v${target.version} by ${me.id}`,
        ip: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown',
      },
    })

    return json({ ok: true, config: { ...target, isLive: true } })
  } catch (e: any) {
    return errorJson(e?.message || 'Server error', 500)
  }
}
