import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { errorJson, json } from '@/lib/serialize'
import { requireSuperAdmin, writeJaraAudit, requestMeta } from '@/lib/jara-admin'
import { uploadDir } from '@/lib/paths'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { randomBytes } from 'crypto'
import { validateMediaBuffer, extForMime, detectMagicMime } from '@/lib/jara-media'
import { getMalwareScanner } from '@/lib/jara-scanner'

export async function POST(req: NextRequest) {
  let me
  try { me = await requireSuperAdmin() } catch (e: any) { return errorJson(e.message === 'UNAUTHORIZED' ? 'Unauthorized' : 'Forbidden — Super Admin only', e.status || 403) }

  const form = await req.formData().catch(() => null)
  if (!form) return errorJson('Invalid multipart form', 400)
  const file = form.get('file')
  if (!(file instanceof File)) return errorJson('file required', 400)
  const kind = String(form.get('kind') || 'reference').slice(0, 40)
  const name = String(form.get('name') || file.name || 'upload').slice(0, 160)
  const purpose = String(form.get('purpose') || kind).slice(0, 60)

  const declaredMime = file.type || 'application/octet-stream'
  const buf = Buffer.from(await file.arrayBuffer())
  const validation = validateMediaBuffer(buf, declaredMime, buf.length)
  if (!validation.ok) return errorJson(validation.error || 'Invalid file', validation.status || 400)

  const scanner = getMalwareScanner()
  const scan = await scanner.scan(buf, file.name)
  if (scan.status === 'infected') {
    await writeJaraAudit({ action: 'attempt_blocked', actorId: me.id, actorRole: me.role, detail: `Blocked infected upload ${file.name}`, authorizationResult: 'denied', ...requestMeta(req) })
    return errorJson('Uploaded file failed malware scan', 422)
  }

  const dir = uploadDir()
  const id = randomBytes(12).toString('hex')
  const ext = extForMime(declaredMime)
  const storedName = `${id}.${ext}`
  writeFileSync(/*turbopackIgnore: true*/ join(/*turbopackIgnore: true*/ dir, storedName), buf)

  let width: number | null = null
  let height: number | null = null
  if (validation.category === 'image') {
    try {
      const sharp = (await import('sharp')).default
      const meta = await sharp(buf).metadata()
      width = meta.width || null
      height = meta.height || null
    } catch {}
  }

  await db.file.create({ data: { ownerId: me.id, name: file.name.slice(0, 255), mimeType: declaredMime, size: buf.length, url: `/api/files/${id}` } }).catch(() => null)
  await db.user.update({ where: { id: me.id }, data: { fileUsedBytes: { increment: buf.length } } }).catch(() => null)

  const asset = await (db as any).jaraAsset.create({
    data: {
      kind, name, description: String(form.get('description') || '').slice(0, 500) || null,
      fileUrl: `/api/files/${id}`, storageKey: storedName, mimeType: declaredMime, fileSize: buf.length,
      width, height, sha256: validation.sha256 || null,
      isApproved: false, status: 'pending_review', source: 'upload', ownerId: me.id,
      metadata: JSON.stringify({
        purpose, declaredMime, detectedMagic: validation.detectedMagic ?? detectMagicMime(buf),
        scanStatus: scan.status, scanDetail: scan.detail, scanner: scan.scanner || null,
        uploadOriginalName: file.name,
      }),
      createdBy: me.id, updatedBy: me.id,
    },
  })

  const meta = requestMeta(req)
  await writeJaraAudit({ action: 'config_change', actorId: me.id, actorRole: me.role, detail: `Uploaded Jara media asset ${asset.name} (${declaredMime}, ${buf.length} bytes, scan=${scan.status})`, newValue: { id: asset.id, kind, mimeType: declaredMime, size: buf.length, scanStatus: scan.status }, authorizationResult: 'allowed', ...meta })

  return json({
    asset,
    file: { id, url: `/api/files/${id}`, mimeType: declaredMime, size: buf.length, width, height, sha256: validation.sha256 },
    security: { signatureChecked: validation.detectedMagic != null, scanStatus: scan.status, scanDetail: scan.detail },
  }, 201)
}