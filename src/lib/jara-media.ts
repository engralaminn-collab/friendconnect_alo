import { createHash } from 'crypto'

export type MediaCategory = 'image' | 'video' | 'audio'

export const JARA_MEDIA_LIMITS = {
  image: 10 * 1024 * 1024,
  video: 100 * 1024 * 1024,
  audio: 20 * 1024 * 1024,
} as const

export const JARA_ALLOWED_MIME: Record<MediaCategory, Set<string>> = {
  image: new Set(['image/jpeg', 'image/png', 'image/webp']),
  video: new Set(['video/mp4', 'video/webm', 'video/quicktime']),
  audio: new Set(['audio/mpeg', 'audio/wav', 'audio/mp4', 'audio/webm', 'audio/ogg', 'audio/x-m4a']),
}

export function detectMagicMime(buf: Buffer): string | null {
  if (buf.length < 12) return null
  const b = buf
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  if (b.slice(0, 4).toString('ascii') === 'RIFF' && b.slice(8, 12).toString('ascii') === 'WEBP') return 'image/webp'
  if (b.slice(4, 8).toString('ascii') === 'ftyp') {
    const brand = b.slice(8, 12).toString('ascii')
    if (brand === 'qt  ') return 'video/quicktime'
    if (brand.toUpperCase().includes('M4A')) return 'audio/mp4'
    return 'video/mp4'
  }
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'video/webm' // EBML; caller may allow audio/webm
  if (b.slice(0, 4).toString('ascii') === 'OggS') return 'audio/ogg'
  if (b.slice(0, 4).toString('ascii') === 'RIFF' && b.slice(8, 12).toString('ascii') === 'WAVE') return 'audio/wav'
  if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) return 'audio/mpeg'
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return 'audio/mpeg'
  return null
}

export function categoryForMime(mime: string): MediaCategory | null {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  return null
}

export function mimeAllowed(mime: string): boolean {
  const cat = categoryForMime(mime)
  return !!cat && JARA_ALLOWED_MIME[cat].has(mime)
}

export function signatureMatchesDeclared(declared: string, detected: string | null): boolean {
  if (!detected) return true // unknown signature: do not accept blindly in high-security, but allow with warning in this env; caller decides
  if (detected === declared) return true
  if (declared === 'audio/webm' && detected === 'video/webm') return true // EBML container ambiguity
  if (declared === 'video/quicktime' && detected === 'video/mp4') return true // ftyp brand ambiguity
  if (declared === 'audio/mp4' && (detected === 'video/mp4' || detected === 'video/quicktime')) return true
  return false
}

export function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

export function extForMime(mime: string): string {
  const map: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/webm': 'webm', 'audio/ogg': 'ogg' }
  return map[mime] || 'bin'
}

export interface MediaValidationResult {
  ok: boolean
  error?: string
  status?: number
  category?: MediaCategory
  detectedMagic?: string | null
  sha256?: string
}

export function validateMediaBuffer(buf: Buffer, declaredMime: string, size: number): MediaValidationResult {
  const category = categoryForMime(declaredMime)
  if (!category) return { ok: false, error: 'Unsupported file category', status: 415 }
  if (!JARA_ALLOWED_MIME[category].has(declaredMime)) return { ok: false, error: `Unsupported ${category} type: ${declaredMime}`, status: 415 }
  const max = JARA_MEDIA_LIMITS[category]
  if (size <= 0 || size > max) return { ok: false, error: `File too large or empty (max ${Math.round(max / 1024 / 1024)}MB)`, status: 413 }
  const detectedMagic = detectMagicMime(buf)
  if (detectedMagic && !signatureMatchesDeclared(declaredMime, detectedMagic)) {
    return { ok: false, error: `File signature does not match declared type (${declaredMime})`, status: 415, detectedMagic }
  }
  return { ok: true, category, detectedMagic, sha256: sha256Hex(buf) }
}