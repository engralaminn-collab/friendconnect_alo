import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { errorJson, json } from '@/lib/serialize'
import { mkdir, unlink, writeFile } from 'fs/promises'
import { join } from 'path'
import { randomBytes } from 'crypto'
import { logger } from '@/lib/logger'
import { uploadDir } from '@/lib/paths'
import { rateLimit } from '@/lib/cache'
import { clientIp } from '@/lib/auth'
import { safeDownloadName, validateUpload, sanitizeRasterImage } from '@/lib/upload-security.cjs'
import { grantFileAccess } from '@/lib/file-access'

const MAX_FILE_SIZE = 50 * 1024 * 1024
const IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp'])
const EXT_FOR_MIME: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'application/pdf': 'pdf', 'video/mp4': 'mp4', 'video/webm': 'webm',
  'video/quicktime': 'mov', 'audio/mpeg': 'mp3', 'audio/wav': 'wav',
  'audio/mp4': 'm4a', 'audio/webm': 'webm', 'audio/ogg': 'ogg',
}

export async function POST(req: NextRequest) {
  let diskPath: string | null = null
  let createdFileId: string | null = null
  let usageIncremented = false
  let ownerId: string | null = null
  let finalSize = 0
  try {
    const me = await getSessionUser()
    if (!me) return errorJson('Unauthorized', 401)
    ownerId = me.id
    const ip = clientIp(req) || me.id
    const rl = await rateLimit(`upload:${ip}`, 30, 60)
    if (!rl.allowed) return errorJson('Upload rate limit exceeded', 429)

    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) return errorJson('No file provided', 400)
    // Check declared size before allocating an ArrayBuffer or invoking a decoder.
    if (file.size <= 0) return errorJson('Empty files are not supported', 400)
    if (file.size > MAX_FILE_SIZE) return errorJson('File too large (max 50MB)', 413)

    const originalName = safeDownloadName(file.name, 'bin')
    const bytes = Buffer.from(await file.arrayBuffer())
    const validation: any = validateUpload(bytes, originalName, file.type, MAX_FILE_SIZE)
    if (!validation.ok) return errorJson(validation.error || 'Unsupported file', validation.status || 415)

    let storedBytes: Uint8Array = new Uint8Array(bytes)
    const finalMime = validation.safeMime as string
    if (IMAGE_MIME.has(finalMime)) {
      // Decode and re-encode raster images to strip metadata and any polyglot
      // trailing content. An image is not accepted merely because it has a magic prefix.
      storedBytes = await sanitizeRasterImage(bytes, finalMime)
      if (!storedBytes.length || storedBytes.length > MAX_FILE_SIZE) {
        return errorJson('Processed image exceeds the 50MB limit', 413)
      }
    }

    finalSize = storedBytes.length
    const user = await db.user.findUnique({
      where: { id: me.id },
      select: { fileQuotaBytes: true, fileUsedBytes: true },
    })
    if (!user) return errorJson('User not found', 404)
    if (user.fileUsedBytes + finalSize > user.fileQuotaBytes) return errorJson('Storage quota exceeded', 507)

    const dir = uploadDir()
    await mkdir(dir, { recursive: true })
    const id = randomBytes(24).toString('hex')
    const storedName = `${id}.${EXT_FOR_MIME[finalMime]}`
    diskPath = join(/*turbopackIgnore: true*/ dir, storedName)
    await writeFile(diskPath, storedBytes, { flag: 'wx', mode: 0o600 })

    const fileRecord = await db.file.create({
      data: {
        ownerId: me.id,
        name: originalName,
        mimeType: finalMime,
        size: finalSize,
        url: `/api/files/${id}`,
      },
    })
    createdFileId = fileRecord.id

    // Finding #10: record the owner's download grant at upload time. Deriving it
    // later meant every download scanned the Message table.
    await grantFileAccess(fileRecord.url, me.id, 'owner')

    await db.user.update({ where: { id: me.id }, data: { fileUsedBytes: { increment: finalSize } } })
    usageIncremented = true
    logger.info('file uploaded', { userId: me.id, fileId: id, size: finalSize, mime: finalMime })
    return json({ file: { id, url: fileRecord.url, name: originalName, mimeType: finalMime, size: finalSize } })
  } catch (error) {
    // Roll back every completed stage: failed DB writes must not leave an
    // orphaned storage object or a dangling File row.
    if (createdFileId) await db.file.delete({ where: { id: createdFileId } }).catch(() => {})
    if (usageIncremented && ownerId) {
      await db.user.update({ where: { id: ownerId }, data: { fileUsedBytes: { decrement: finalSize } } }).catch(() => {})
    }
    if (diskPath) await unlink(diskPath).catch(() => {})
    logger.error('file upload failed', { error: (error as Error)?.message })
    return errorJson('Upload failed', 500)
  }
}
