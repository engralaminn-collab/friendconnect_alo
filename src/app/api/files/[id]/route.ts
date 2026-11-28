import { db } from '@/lib/db'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { getSessionUser } from '@/lib/session'
import { uploadDir } from '@/lib/paths'
import { canDownloadFile } from '@/lib/file-access'
import { validateUpload, downloadHeaders } from '@/lib/upload-security.cjs'
import { parseRange } from '@/lib/http-range.cjs'

const EXT_FOR_MIME: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'application/pdf': 'pdf', 'video/mp4': 'mp4', 'video/webm': 'webm',
  'video/quicktime': 'mov', 'audio/mpeg': 'mp3', 'audio/wav': 'wav',
  'audio/mp4': 'm4a', 'audio/webm': 'webm', 'audio/ogg': 'ogg',
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await getSessionUser()
  if (!me) return new Response('Unauthorized', { status: 401 })

  const { id } = await params
  // Current upload IDs are 192-bit hex; allow the old 96-bit IDs during rollout.
  if (!/^[a-f0-9]{24,48}$/i.test(id)) return new Response('Not found', { status: 404 })
  const file = await db.file.findFirst({ where: { url: `/api/files/${id}` } })
  if (!file) return new Response('Not found', { status: 404 })
  if (!(await canDownloadFile(me.id, file))) return new Response('Forbidden', { status: 403 })

  const ext = EXT_FOR_MIME[file.mimeType]
  if (!ext) return new Response('Unsupported stored file', { status: 415 })
  let bytes: Buffer
  try {
    bytes = await readFile(/*turbopackIgnore: true*/ join(/*turbopackIgnore: true*/ uploadDir(), `${id}.${ext}`))
  } catch {
    return new Response('File missing', { status: 404 })
  }

  // Revalidate both the storage object and its database metadata on every read.
  // Old arbitrary/active content is denied rather than served with unsafe metadata.
  const validation = validateUpload(bytes, file.name, file.mimeType, 50 * 1024 * 1024)
  if (!validation.ok || validation.safeMime !== file.mimeType) {
    return new Response('Invalid stored file', { status: 415 })
  }

  // Finding 27: honour a single HTTP Range so media players can seek and
  // interrupted downloads can resume. The full object was already validated above.
  const headers = { ...downloadHeaders(file.name, ext, file.mimeType), 'accept-ranges': 'bytes' }
  const range = parseRange(req.headers.get('range'), bytes.length)
  if (range.type === 'unsatisfiable') {
    return new Response(null, {
      status: 416,
      headers: { 'content-range': `bytes */${bytes.length}`, 'accept-ranges': 'bytes', 'cache-control': 'private, no-store' },
    })
  }
  if (range.type === 'partial') {
    const slice = bytes.subarray(range.start, range.end + 1)
    return new Response(new Uint8Array(slice), {
      status: 206,
      headers: {
        ...headers,
        'content-length': String(slice.length),
        'content-range': `bytes ${range.start}-${range.end}/${bytes.length}`,
      },
    })
  }
  return new Response(new Uint8Array(bytes), {
    headers: { ...headers, 'content-length': String(bytes.length) },
  })
}
