import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { errorJson, json } from '@/lib/serialize'
import { requireSuperAdmin, writeJaraAudit, requestMeta } from '@/lib/jara-admin'

export async function GET() {
  try { await requireSuperAdmin() } catch (e: any) { return errorJson(e.message === 'UNAUTHORIZED' ? 'Unauthorized' : 'Forbidden — Super Admin only', e.status || 403) }
  const sources = await (db as any).jaraKnowledgeSource.findMany({ orderBy: { updatedAt: 'desc' }, take: 200 }).catch(() => [])
  return json({ sources })
}

export async function POST(req: NextRequest) {
  let me
  try { me = await requireSuperAdmin() } catch (e: any) { return errorJson(e.message === 'UNAUTHORIZED' ? 'Unauthorized' : 'Forbidden — Super Admin only', e.status || 403) }
  let body: any
  try { body = await req.json() } catch { return errorJson('Invalid JSON', 400) }
  const title = String(body.title || '').trim().slice(0, 200)
  if (!title) return errorJson('title required', 400)
  const source = await (db as any).jaraKnowledgeSource.create({ data: {
    title,
    sourceType: String(body.sourceType || 'text').slice(0, 40),
    content: body.content ? String(body.content).slice(0, 20000) : null,
    sourceUrl: body.sourceUrl ? String(body.sourceUrl).slice(0, 1000) : null,
    language: body.language ? String(body.language).slice(0, 16) : null,
    tags: body.tags ? (typeof body.tags === 'string' ? body.tags : JSON.stringify(body.tags)) : null,
    isApproved: Boolean(body.isApproved),
    approvedBy: body.isApproved ? me.id : null,
    approvedAt: body.isApproved ? new Date() : null,
    status: body.isApproved ? 'approved' : 'draft',
    createdBy: me.id, updatedBy: me.id,
  } })
  const meta = requestMeta(req)
  await writeJaraAudit({ action: 'config_change', actorId: me.id, actorRole: me.role, detail: `Created knowledge source ${source.title}`, newValue: { id: source.id, title: source.title, status: source.status }, authorizationResult: 'allowed', ...meta })
  return json({ source }, 201)
}