import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { errorJson, json } from '@/lib/serialize'
import { validationFailure } from '@/lib/jara-route-guards'
import { requireSuperAdmin, writeJaraAudit, requestMeta } from '@/lib/jara-admin'

const ALLOWED_MIME = new Set(['image/png','image/jpeg','image/webp','image/svg+xml'])
const MAX_SIZE = 5 * 1024 * 1024

function validateTrustedAssetUrl(url?: string | null) {
  if (!url) return null
  const v = String(url).trim()
  if (v.startsWith('/uploads/') || v.startsWith('/api/files/')) return v
  // Allow same-origin absolute paths only; reject arbitrary external URLs
  throw Object.assign(new Error('Asset URL must be a trusted local upload path (/uploads/... or /api/files/...)'), { status: 400 })
}

export async function GET(req: NextRequest) {
  try { await requireSuperAdmin() } catch (e: any) { return errorJson(e.message === 'UNAUTHORIZED' ? 'Unauthorized' : 'Forbidden — Super Admin only', e.status || 403) }
  const kind = req.nextUrl.searchParams.get('kind')
  const where: any = {}
  if (kind) where.kind = kind
  const assets = await (db as any).jaraAsset.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200 }).catch(() => [])
  return json({ assets })
}

export async function POST(req: NextRequest) {
  let me
  try { me = await requireSuperAdmin() } catch (e: any) { return errorJson(e.message === 'UNAUTHORIZED' ? 'Unauthorized' : 'Forbidden — Super Admin only', e.status || 403) }
  let body: any
  try { body = await req.json() } catch { return errorJson('Invalid JSON', 400) }
  const name = String(body.name || '').trim().slice(0, 160)
  if (!name) return errorJson('name required', 400)
  const kind = String(body.kind || 'background').slice(0, 40)
  const mimeType = body.mimeType ? String(body.mimeType).slice(0, 80) : null
  if (mimeType && !ALLOWED_MIME.has(mimeType)) return errorJson('Unsupported mimeType', 400)
  const fileSize = body.fileSize != null ? Number(body.fileSize) : null
  if (fileSize != null && (fileSize <= 0 || fileSize > MAX_SIZE)) return errorJson('Invalid fileSize', 400)
  let fileUrl: string | null = null
  try { fileUrl = validateTrustedAssetUrl(body.fileUrl) } catch (e) {
    const failure = validationFailure(e, 'Invalid asset URL')
    return errorJson(failure.message, failure.status)
  }
  const asset = await (db as any).jaraAsset.create({ data: {
    kind, name, description: body.description ? String(body.description).slice(0, 500) : null,
    fileUrl, storageKey: body.storageKey ? String(body.storageKey).slice(0, 300) : null,
    mimeType, fileSize, width: body.width ? Number(body.width) : null, height: body.height ? Number(body.height) : null,
    sha256: body.sha256 ? String(body.sha256).slice(0, 128) : null,
    isApproved: Boolean(body.isApproved), approvedBy: body.isApproved ? me.id : null, approvedAt: body.isApproved ? new Date() : null,
    status: body.isApproved ? 'approved' : 'pending_review', source: 'upload', ownerId: me.id,
    metadata: body.metadata ? (typeof body.metadata === 'string' ? body.metadata : JSON.stringify(body.metadata)) : null,
    createdBy: me.id, updatedBy: me.id,
  } })
  const meta = requestMeta(req)
  await writeJaraAudit({ action: 'config_change', actorId: me.id, actorRole: me.role, detail: `Created Jara asset ${asset.name} (${asset.kind})`, newValue: { id: asset.id, kind: asset.kind, status: asset.status }, authorizationResult: 'allowed', ...meta })
  return json({ asset }, 201)
}