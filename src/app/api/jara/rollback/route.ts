import { NextRequest } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { errorJson, json } from '@/lib/serialize'
import { db } from '@/lib/db'
import { hashConfig } from '@/lib/jara'

// POST /api/jara/rollback — create a rollback proposal (requires approval like any change)
export async function POST(req: NextRequest) {
  const me = await getSessionUser()
  if (!me) return errorJson('Unauthorized', 401)
  if (me.role !== 'admin' && me.role !== 'superadmin') return errorJson('Forbidden — Super Admin only', 403)

  let body: any
  try { body = await req.json() } catch { return errorJson('Invalid JSON', 400) }

  const targetVersion = Number(body.targetVersion)
  if (!targetVersion) return errorJson('targetVersion required', 400)

  const target = await (db as any).jaraConfig.findUnique({ where: { version: targetVersion } }).catch(() => null)
  if (!target) return errorJson('Target version not found', 404)

  const live = await (db as any).jaraConfig.findFirst({ where: { isLive: true }, orderBy: { version: 'desc' } }).catch(() => null)
  if (!live) return errorJson('No live config', 500)
  if (live.version === targetVersion) return errorJson('Already on that version', 400)

  const nextVersion = live.version + 1
  // Build rollback config (copy target but with new version + live flag)
  const rollbackConfig = { ...target, version: nextVersion, isLive: true, createdBy: me.id }
  delete rollbackConfig.id
  delete rollbackConfig.createdAt
  delete rollbackConfig.updatedAt

  const hashable = { ...rollbackConfig }
  delete (hashable as any).id; delete (hashable as any).createdAt; delete (hashable as any).updatedAt; delete (hashable as any).createdBy; delete (hashable as any).isLive
  const configHash = hashConfig(hashable)
  const configJson = JSON.stringify(rollbackConfig)

  const proposal = await (db as any).jaraProposal.create({
    data: {
      version: nextVersion,
      previousVersion: live.version,
      configJson,
      configHash,
      status: 'pending',
      createdBy: me.id,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      changeSummary: `Rollback to v${targetVersion} (from v${live.version})`,
    },
  })

  await (db as any).jaraAuditLog.create({
    data: {
      proposalId: proposal.id,
      version: nextVersion,
      action: 'propose',
      actorId: me.id,
      actorRole: me.role,
      detail: `Rollback proposal: v${live.version} → v${targetVersion} (as v${nextVersion})`,
      ip: req.headers.get('x-forwarded-for') || 'unknown',
    },
  })

  return json({ proposal, target, live }, 201)
}
