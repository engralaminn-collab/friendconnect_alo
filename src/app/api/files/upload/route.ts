import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { errorJson, json } from '@/lib/serialize'
import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { randomBytes } from 'crypto'

const UPLOAD_DIR = '/home/z/my-project/upload'

export async function POST(req: NextRequest) {
  try {
    const me = await getSessionUser()
    if (!me) return errorJson('Unauthorized', 401)
    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) return errorJson('No file provided', 400)

    if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true })
    const ext = (file.name.split('.').pop() || 'bin').toLowerCase().slice(0, 8)
    const id = randomBytes(12).toString('hex')
    const storedName = `${id}.${ext}`
    const buf = Buffer.from(await file.arrayBuffer())
    writeFileSync(join(UPLOAD_DIR, storedName), buf)

    const fileRecord = await db.file.create({
      data: {
        ownerId: me.id,
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        size: buf.length,
        url: `/api/files/${id}`,
      },
    })
    return json({ file: { id, url: fileRecord.url, name: fileRecord.name, mimeType: fileRecord.mimeType, size: fileRecord.size } })
  } catch (e: any) {
    return errorJson(e?.message || 'Server error', 500)
  }
}
