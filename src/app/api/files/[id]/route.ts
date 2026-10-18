import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { existsSync, readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { getSessionUser } from '@/lib/session'
import { uploadDir } from '@/lib/paths'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await getSessionUser()
  if (!me) return new Response('Unauthorized', { status: 401 })

  const { id } = await params
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) return new Response('Not found', { status: 404 })

  const file = await db.file.findFirst({
    where: { OR: [{ id }, { url: `/api/files/${id}` }] },
  })
  if (!file) return new Response('Not found', { status: 404 })

  const dir = uploadDir()
  let match: string | undefined
  if (existsSync(/*turbopackIgnore: true*/ join(/*turbopackIgnore: true*/ dir, `${id}.bin`))) match = `${id}.bin`
  else {
    try {
      match = readdirSync(/*turbopackIgnore: true*/ dir).find((f) => f.startsWith(id + '.'))
    } catch {
      match = undefined
    }
  }
  if (!match) return new Response('File missing', { status: 404 })

  const buf = readFileSync(/*turbopackIgnore: true*/ join(/*turbopackIgnore: true*/ dir, match))
  const safeName = file.name.replace(/[\r\n"]/g, '_')
  return new Response(buf, {
    headers: {
      'content-type': file.mimeType,
      'content-disposition': `inline; filename="${encodeURIComponent(safeName)}"`,
      'cache-control': 'private, max-age=3600',
      'x-content-type-options': 'nosniff',
    },
  })
}
