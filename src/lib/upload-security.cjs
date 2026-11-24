'use strict'

// Explicit types that the application can safely store as private downloads.
// Browser-active formats (HTML, SVG, XML, JavaScript, etc.) are intentionally absent.
const TYPES = Object.freeze({
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
  'application/pdf': ['pdf'],
  'video/mp4': ['mp4'],
  'video/webm': ['webm'],
  'video/quicktime': ['mov'],
  'audio/mpeg': ['mp3'],
  'audio/wav': ['wav'],
  'audio/mp4': ['m4a'],
  'audio/webm': ['webm'],
  'audio/ogg': ['ogg'],
})

function detectUploadType(buffer) {
  const b = Buffer.from(buffer)
  if (b.length >= 12 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length >= 12 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  if (b.length >= 12 && b.toString('ascii', 4, 8) === 'ftyp') {
    const brand = b.toString('ascii', 8, 12)
    if (brand === 'qt  ') return 'video/quicktime'
    if (/M4A/i.test(brand)) return 'audio/mp4'
    return 'video/mp4'
  }
  if (b.length >= 12 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'video/webm'
  if (b.length >= 12 && b.toString('ascii', 0, 4) === 'OggS') return 'audio/ogg'
  if (b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WAVE') return 'audio/wav'
  if (b.length >= 12 && b.toString('ascii', 0, 3) === 'ID3') return 'audio/mpeg'
  if (b.length >= 12 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return 'audio/mpeg'
  if (b.length >= 5 && b.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf'
  return null
}

function validateUpload(buffer, fileName, declaredMime, maxBytes = 50 * 1024 * 1024) {
  const b = Buffer.from(buffer)
  if (b.length === 0) return { ok: false, status: 400, error: 'Empty files are not supported' }
  if (b.length > maxBytes) return { ok: false, status: 413, error: 'File too large (max 50MB)' }
  const name = String(fileName || '').replace(/\\/g, '/').split('/').pop() || ''
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : ''
  const mime = String(declaredMime || '').split(';', 1)[0].trim().toLowerCase()
  const allowedExtensions = TYPES[mime]
  if (!allowedExtensions || !allowedExtensions.includes(ext)) {
    return { ok: false, status: 415, error: 'Unsupported file type or extension/MIME mismatch' }
  }
  const detectedMime = detectUploadType(b)
  // EBML is a shared audio/video container; all other types must match exactly.
  const signatureMatches = detectedMime === mime || (mime === 'audio/webm' && detectedMime === 'video/webm')
  if (!signatureMatches) return { ok: false, status: 415, error: 'File content does not match the declared type' }
  return { ok: true, ext, mime, detectedMime, safeMime: mime }
}

async function sanitizeRasterImage(buffer, mime) {
  const format = mime === 'image/jpeg' ? 'jpeg' : mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : null
  if (!format) throw new Error('Unsupported image format')
  const sharp = require('sharp')
  const input = Buffer.from(buffer)
  const metadata = await sharp(input, { limitInputPixels: 40_000_000 }).metadata()
  if (metadata.format !== format) throw new Error('Image decoder format mismatch')
  let pipeline = sharp(input, { limitInputPixels: 40_000_000 }).rotate().toFormat(format)
  if (format === 'jpeg') pipeline = pipeline.jpeg({ quality: 88, mozjpeg: true })
  return pipeline.toBuffer()
}

function downloadHeaders(name, ext, mime) {
  const filename = safeDownloadName(name, ext)
  const asciiFallback = filename.replace(/[^\\x20-\\x7e]/g, '_').replace(/["\\\\]/g, '_')
  return {
    'content-type': mime,
    'content-disposition': `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; sandbox",
  }
}

function safeDownloadName(name, ext) {
  const base = String(name || 'download')
    .replace(/[\\/\u0000-\u001f\u007f<>:"|?*]/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 180)
  return base || `download.${ext}`
}

module.exports = { TYPES, detectUploadType, validateUpload, safeDownloadName, sanitizeRasterImage, downloadHeaders }
