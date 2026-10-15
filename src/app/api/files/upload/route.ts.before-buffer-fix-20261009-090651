import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { errorJson, json } from '@/lib/serialize'
import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { randomBytes } from 'crypto'
import { logger } from '@/lib/logger'

const UPLOAD_DIR = '/home/aloedu/storage/friendconnect'
const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50MB per file
// Blocked MIME types (basic virus-scanning heuristic — reject executables/scripts)
const BLOCKED_MIME = [
  'application/x-msdownload', 'application/x-msdos-program', 'application/x-msi',
  'application/x-executable', 'application/x-dosexec', 'application/x-sh',
  'application/x-bat', 'application/x-csh', 'text/x-script',
]
const BLOCKED_EXT = ['.exe', '.bat', '.cmd', '.sh', '.msi', '.com', '.scr', '.vbs', '.js', '.jar']

export async function POST(req: NextRequest) {
  try {
    const me = await getSessionUser()
    if (!me) return errorJson('Unauthorized', 401)
    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) return errorJson('No file provided', 400)

    // 1. Size limit
    if (file.size > MAX_FILE_SIZE) return errorJson('File too large (max 50MB)', 413)

    // 2. Virus-scanning heuristic: reject dangerous types
    const mimeType = file.type || 'application/octet-stream'
    const ext = (file.name.split('.').pop() || 'bin').toLowerCase().slice(0, 8)
    const fullExt = '.' + ext
    if (BLOCKED_MIME.includes(mimeType) || BLOCKED_EXT.includes(fullExt)) {
      logger.warn('upload blocked (dangerous type)', { userId: me.id, name: file.name, mime: mimeType, ext: fullExt })
      return errorJson('File type not allowed for security reasons', 415)
    }

    // 3. Quota check
    const user = await db.user.findUnique({ where: { id: me.id }, select: { fileQuotaBytes: true, fileUsedBytes: true } })
    if (!user) return errorJson('User not found', 404)
    if (user.fileUsedBytes + file.size > user.fileQuotaBytes) {
      return errorJson('Storage quota exceeded', 507)
    }

    if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true })
    const id = randomBytes(12).toString('hex')
    const storedName = `${id}.${ext}`
    let buf = Buffer.from(await file.arrayBuffer())

    // 4. Image optimization (sharp) — resize large images to max 1920px, convert to optimized JPEG/WebP
    let finalMime = mimeType
    let finalSize = buf.length
    if (mimeType.startsWith('image/') && mimeType !== 'image/gif') {
      try {
        const sharp = (await import('sharp')).default
        const optimized = await sharp(buf)
          .resize(1920, 1920, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 85, mozjpeg: true })
          .toBuffer()
        if (optimized.length < buf.length) {
          buf = optimized
          finalMime = 'image/jpeg'
          finalSize = buf.length
          const optExt = 'jpg'
            // store as jpg
          ;(writeFileSync as any)(join(UPLOAD_DIR, `${id}.${optExt}`), buf)
          logger.info('image optimized', { userId: me.id, original: file.size, optimized: finalSize })
          const fileRecord = await db.file.create({
            data: {
              ownerId: me.id,
              name: file.name,
              mimeType: finalMime,
              size: finalSize,
              url: `/api/files/${id}`,
            },
          })
          await db.user.update({ where: { id: me.id }, data: { fileUsedBytes: { increment: finalSize } } })
          return json({ file: { id, url: fileRecord.url, name: fileRecord.name, mimeType: finalMime, size: finalSize } })
        }
      } catch (e: any) {
        logger.warn('image optimization skipped', { error: e?.message })
      }
    }

    writeFileSync(join(UPLOAD_DIR, storedName), buf)
    const fileRecord = await db.file.create({
      data: {
        ownerId: me.id,
        name: file.name,
        mimeType: finalMime,
        size: finalSize,
        url: `/api/files/${id}`,
      },
    })
    // increment quota usage
    await db.user.update({ where: { id: me.id }, data: { fileUsedBytes: { increment: finalSize } } })
    logger.info('file uploaded', { userId: me.id, fileId: id, size: finalSize, mime: finalMime })
    return json({ file: { id, url: fileRecord.url, name: fileRecord.name, mimeType: finalMime, size: finalSize } })
  } catch (e: any) {
    return errorJson(e?.message || 'Server error', 500)
  }
}
