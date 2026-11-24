'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const sharp = require('sharp')
const {
  detectUploadType,
  validateUpload,
  safeDownloadName,
  sanitizeRasterImage,
  downloadHeaders,
} = require('../../src/lib/upload-security.cjs')

const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array(16).fill(0)])
const jpegHeader = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Array(16).fill(0)])
const pdf = Buffer.from('%PDF-1.7\n%fixture\n')
const mp3 = Buffer.from('ID3' + '\0'.repeat(12))

test('HTML, SVG, JavaScript, and XML are not allowlisted', () => {
  assert.equal(validateUpload(Buffer.from('<html>'), 'x.html', 'text/html').ok, false)
  assert.equal(validateUpload(Buffer.from('<svg/>'), 'x.svg', 'image/svg+xml').ok, false)
  assert.equal(validateUpload(Buffer.from('alert(1)'), 'x.js', 'text/javascript').ok, false)
  assert.equal(validateUpload(Buffer.from('<xml/>'), 'x.xml', 'application/xml').ok, false)
})

test('MIME spoofing and extension/content mismatches are rejected', () => {
  assert.equal(validateUpload(pngHeader, 'image.png', 'image/jpeg').ok, false)
  assert.equal(validateUpload(pngHeader, 'image.jpg', 'image/png').ok, false)
  assert.equal(validateUpload(Buffer.from('<html>'), 'file.pdf', 'application/pdf').ok, false)
})

test('supported PDF and media types require their expected signatures', () => {
  assert.equal(validateUpload(pdf, 'report.pdf', 'application/pdf').ok, true)
  assert.equal(validateUpload(mp3, 'voice.mp3', 'audio/mpeg').ok, true)
  assert.equal(detectUploadType(pdf), 'application/pdf')
  assert.equal(validateUpload(Buffer.from('not-a-video-file'), 'clip.mp4', 'video/mp4').ok, false)
})

test('valid raster images pass signature checks and are decoded/re-encoded', async () => {
  const validPng = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#ff00ff' } }).png().toBuffer()
  const validJpeg = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#123456' } }).jpeg().toBuffer()
  assert.equal(validateUpload(validPng, 'photo.png', 'image/png').ok, true)
  assert.equal(validateUpload(validJpeg, 'photo.jpg', 'image/jpeg').ok, true)
  const sanitized = await sanitizeRasterImage(Buffer.concat([validPng, Buffer.from('<script>bad()</script>')]), 'image/png')
  assert.equal((await sharp(sanitized).metadata()).format, 'png')
  assert.ok(!sanitized.includes(Buffer.from('<script>')))
})

test('size and empty-file checks are enforced', () => {
  assert.equal(validateUpload(Buffer.alloc(0), 'x.png', 'image/png').status, 400)
  assert.equal(validateUpload(pngHeader, 'x.png', 'image/png', 2).status, 413)
})

test('download headers force attachment, safe MIME, no-store, and nosniff', () => {
  const headers = downloadHeaders('../../report.pdf', 'pdf', 'application/pdf')
  assert.match(headers['content-disposition'], /^attachment;/)
  assert.equal(headers['content-type'], 'application/pdf')
  assert.equal(headers['x-content-type-options'], 'nosniff')
  assert.equal(headers['cache-control'], 'private, no-store')
  assert.match(headers['content-security-policy'], /sandbox/)
})

test('filename sanitization removes traversal and control characters', () => {
  const name = safeDownloadName('../../evil\\file\r\n.pdf', 'pdf')
  assert.equal(name.includes('/'), false)
  assert.equal(name.includes('\\'), false)
  assert.equal(/[\r\n]/.test(name), false)
  assert.equal(name.startsWith('.'), false)
})
