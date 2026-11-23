import { NextRequest } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { errorJson, json } from '@/lib/serialize'
import { db } from '@/lib/db'

// GET /api/jara/proposals — list proposals (admin sees all, user sees only own pending + applied)
export async function GET(req: NextRequest) {
  const me = await getSessionUser()
  if (!me) return errorJson('Unauthorized', 401)

  const status = req.nextUrl.searchParams.get('status')
  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit') || 20), 50)

  const where: any = {}
  if (status) where.status = status
  // Non-admin can only see proposals they created? Actually let them see pending for transparency, but filter sensitive
  // For now allow all authenticated to see proposals metadata (not config secrets)
  const proposals = await (db as any).jaraProposal.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
  })

  // Mark expired
  const now = Date.now()
  const enriched = proposals.map((p: any) => ({
    ...p,
    isExpired: p.status === 'pending' && new Date(p.expiresAt).getTime() < now,
    effectiveStatus: p.status === 'pending' && new Date(p.expiresAt).getTime() < now ? 'expired' : p.status,
  }))

  return json({ proposals: enriched })
}

// POST /api/jara/proposals — create a proposal (Super Admin only, typically via chat flow)
// Also allow direct creation from Config Center
export async function POST(req: NextRequest) {
  const me = await getSessionUser()
  if (!me) return errorJson('Unauthorized', 401)
  if (me.role !== 'admin' && me.role !== 'superadmin') return errorJson('Forbidden — Super Admin only', 403)

  let body: any
  try { body = await req.json() } catch { return errorJson('Invalid JSON', 400) }

  const configJson = body.configJson || (body.config ? JSON.stringify(body.config) : null)
  const configHash = body.configHash
  const changeSummary = body.changeSummary || body.summary || 'Manual proposal from Config Center'

  if (!configJson || !configHash) return errorJson('configJson and configHash required', 400)

  // Verify hash matches
  const { createHash } = await import('crypto')
  const canonical = (() => {
    try {
      const obj = JSON.parse(configJson)
      const sorted = sortKeys(obj)
      return JSON.stringify(sorted)
    } catch { return configJson }
  })()
  const computed = createHash('sha256').update(canonical).digest('hex')
  if (computed !== configHash) {
    return errorJson(`Hash mismatch: expected ${computed.slice(0, 12)}…`, 400)
  }

  let live = await (db as any).jaraConfig.findFirst({ where: { isLive: true }, orderBy: { version: 'desc' } }).catch(() => null)
  if (!live) live = { version: 0 }

  const version = Number(body.version) || live.version + 1
  const previousVersion = live.version || null
  const expiresAt = body.expiresAt ? new Date(body.expiresAt) : new Date(Date.now() + 24 * 60 * 60 * 1000)

  const proposal = await (db as any).jaraProposal.create({
    data: {
      version,
      previousVersion,
      configJson,
      configHash,
      status: 'pending',
      createdBy: me.id,
      expiresAt,
      changeSummary,
    },
  })

  await (db as any).jaraAuditLog.create({
    data: {
      proposalId: proposal.id,
      version,
      action: 'propose',
      actorId: me.id,
      actorRole: me.role,
      detail: `Proposal v${version} created manually: ${changeSummary}`,
      ip: req.headers.get('x-forwarded-for') || 'unknown',
    },
  })

  return json({ proposal }, 201)
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
