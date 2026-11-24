import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { errorJson, json } from '@/lib/serialize'
import { requireSuperAdmin, writeJaraAudit, requestMeta } from '@/lib/jara-admin'
import { uploadDir } from '@/lib/paths'
import { mkdirSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { createHash, randomBytes } from 'crypto'
import { validateMediaBuffer, extForMime, detectMagicMime } from '@/lib/jara-media'
import { getMalwareScanner } from '@/lib/jara-scanner'
import { safeDownloadName, sanitizeRasterImage } from '@/lib/upload-security.cjs'
import { grantFileAccess } from '@/lib/file-access'

const IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp'])

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

  const rawMime = (file.type || 'application/octet-stream').split(';', 1)[0].trim().toLowerCase()
  const declaredMime = rawMime === 'audio/x-m4a' ? 'audio/mp4' : rawMime
  const rawBuf = Buffer.from(await file.arrayBuffer())
  const validation = validateMediaBuffer(rawBuf, declaredMime, rawBuf.length)
  if (!validation.ok) return errorJson(validation.error || 'Invalid file', validation.status || 400)

  const scanner = getMalwareScanner()
  const scan = await scanner.scan(rawBuf, file.name)
  if (scan.status === 'infected') {
    await writeJaraAudit({ action: 'attempt_blocked', actorId: me.id, actorRole: me.role, detail: `Blocked infected upload ${file.name}`, authorizationResult: 'denied', ...requestMeta(req) })
    return errorJson('Uploaded file failed malware scan', 422)
  }

  let finalBuf: Buffer = rawBuf
  if (IMAGE_MIME.has(declaredMime)) {
    try {
      finalBuf = Buffer.from(await sanitizeRasterImage(rawBuf, declaredMime))
    } catch {
      return errorJson('Invalid or corrupted image file', 415)
    }
  }

  const user = await db.user.findUnique({
    where: { id: me.id },
    select: { fileQuotaBytes: true, fileUsedBytes: true },
  })
  if (!user) return errorJson('User not found', 404)
  if (user.fileUsedBytes + finalBuf.length > user.fileQuotaBytes) {
    return errorJson('Storage quota exceeded', 507)
  }

  const dir = uploadDir()
  mkdirSync(dir, { recursive: true })
  const id = randomBytes(16).toString('hex')
  const ext = extForMime(declaredMime)
  const storedName = `${id}.${ext}`
  const diskPath = join(/*turbopackIgnore: true*/ dir, storedName)
  const safeBase = safeDownloadName(file.name, ext)
  const safeFileName = safeBase.toLowerCase().endsWith(`.${ext}`) ? safeBase : `${safeBase.replace(/\.[^.]+$/, '')}.${ext}`
  const sha256 = createHash('sha256').update(finalBuf).digest('hex')

  let width: number | null = null
  let height: number | null = null
  if (validation.category === 'image') {
    try {
      const sharp = (await import('sharp')).default
      const meta = await sharp(finalBuf).metadata()
      width = meta.width || null
      height = meta.height || null
    } catch {}
  }

  writeFileSync(/*turbopackIgnore: true*/ diskPath, finalBuf, { flag: 'wx', mode: 0o600 })

  let createdFileId: string | null = null
  try {
    const fileRow = await db.file.create({
      data: {
        ownerId: me.id,
        name: safeFileName.slice(0, 255),
        mimeType: declaredMime,
        size: finalBuf.length,
        url: `/api/files/${id}`,
      },
    })
    createdFileId = fileRow.id
    await grantFileAccess(fileRow.url, me.id, 'owner')
    await db.user.update({ where: { id: me.id }, data: { fileUsedBytes: { increment: finalBuf.length } } })

    const asset = await (db as any).jaraAsset.create({
      data: {
        kind, name, description: String(form.get('description') || '').slice(0, 500) || null,
        fileUrl: `/api/files/${id}`, storageKey: storedName, mimeType: declaredMime, fileSize: finalBuf.length,
        width, height, sha256,
        isApproved: false, status: 'pending_review', source: 'upload', ownerId: me.id,
        metadata: JSON.stringify({
          purpose, declaredMime, detectedMagic: validation.detectedMagic ?? detectMagicMime(finalBuf),
          scanStatus: scan.status, scanDetail: scan.detail, scanner: scan.scanner || null,
          uploadOriginalName: file.name,
        }),
        createdBy: me.id, updatedBy: me.id,
      },
    })

    const meta = requestMeta(req)
    await writeJaraAudit({ action: 'config_change', actorId: me.id, actorRole: me.role, detail: `Uploaded Jara media asset ${asset.name} (${declaredMime}, ${finalBuf.length} bytes, scan=${scan.status})`, newValue: { id: asset.id, kind, mimeType: declaredMime, size: finalBuf.length, scanStatus: scan.status }, authorizationResult: 'allowed', ...meta })

    return json({
      asset,
      file: { id, url: `/api/files/${id}`, mimeType: declaredMime, size: finalBuf.length, width, height, sha256 },
      security: { signatureChecked: validation.detectedMagic != null, scanStatus: scan.status, scanDetail: scan.detail },
    }, 201)
  } catch {
    if (createdFileId) await db.file.delete({ where: { id: createdFileId } }).catch(() => {})
    try { unlinkSync(diskPath) } catch {}
    return errorJson('Asset upload failed', 500)
  }
}
