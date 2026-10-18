import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { errorJson, json } from '@/lib/serialize'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { randomBytes } from 'crypto'
import { logger } from '@/lib/logger'
import { uploadDir } from '@/lib/paths'
import { rateLimit } from '@/lib/cache'
import { clientIp } from '@/lib/auth'

const MAX_FILE_SIZE = 50 * 1024 * 1024
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
    const ip = clientIp(req) || me.id
    const rl = await rateLimit(`upload:${ip}`, 30, 60)
    if (!rl.allowed) return errorJson('Upload rate limit exceeded', 429)

    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) return errorJson('No file provided', 400)

    if (file.size > MAX_FILE_SIZE) return errorJson('File too large (max 50MB)', 413)

    const mimeType = file.type || 'application/octet-stream'
    const ext = (file.name.split('.').pop() || 'bin').toLowerCase().slice(0, 8)
    const fullExt = '.' + ext
    if (BLOCKED_MIME.includes(mimeType) || BLOCKED_EXT.includes(fullExt)) {
      logger.warn('upload blocked (dangerous type)', { userId: me.id, name: file.name, mime: mimeType, ext: fullExt })
      return errorJson('File type not allowed for security reasons', 415)
    }

    const user = await db.user.findUnique({ where: { id: me.id }, select: { fileQuotaBytes: true, fileUsedBytes: true } })
    if (!user) return errorJson('User not found', 404)
    if (user.fileUsedBytes + file.size > user.fileQuotaBytes) {
      return errorJson('Storage quota exceeded', 507)
    }

    const dir = uploadDir()
    const id = randomBytes(12).toString('hex')
    let buf: Buffer = Buffer.from(await file.arrayBuffer())

    let finalMime = mimeType
    let finalSize = buf.length
    let storedName = `${id}.${ext}`

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
          storedName = `${id}.jpg`
          logger.info('image optimized', { userId: me.id, original: file.size, optimized: finalSize })
        }
      } catch (e: unknown) {
        const err = e as Error
        logger.warn('image optimization skipped', { error: err?.message })
      }
    }

    writeFileSync(/*turbopackIgnore: true*/ join(/*turbopackIgnore: true*/ dir, storedName), buf)
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
    logger.info('file uploaded', { userId: me.id, fileId: id, size: finalSize, mime: finalMime })
    return json({ file: { id, url: fileRecord.url, name: fileRecord.name, mimeType: finalMime, size: finalSize } })
  } catch (e: unknown) {
    const err = e as Error
    return errorJson(err?.message || 'Server error', 500)
  }
}
