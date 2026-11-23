import test from 'node:test'
import assert from 'node:assert/strict'
import { validateMediaBuffer, detectMagicMime, signatureMatchesDeclared, extForMime } from '../../src/lib/jara-media'

function buf(bytes: number[]) { return Buffer.from(bytes) }

test('detects JPEG magic', () => {
  const jpeg = buf([0xff,0xd8,0xff,0xe0,0,0,0,0,0,0,0,0])
  assert.equal(detectMagicMime(jpeg), 'image/jpeg')
})

test('detects PNG magic', () => {
  const png = buf([0x89,0x50,0x4e,0x47,0,0,0,0,0,0,0,0])
  assert.equal(detectMagicMime(png), 'image/png')
})

test('rejects mismatched signature', () => {
  const png = buf([0x89,0x50,0x4e,0x47,0,0,0,0,0,0,0,0])
  const r = validateMediaBuffer(png, 'image/jpeg', png.length)
  assert.equal(r.ok, false)
  assert.equal(r.status, 415)
})

test('accepts matching image buffer', () => {
  const jpeg = buf([0xff,0xd8,0xff,0xe0, ...Array(20).fill(0)])
  const r = validateMediaBuffer(jpeg, 'image/jpeg', jpeg.length)
  assert.equal(r.ok, true)
  assert.equal(r.category, 'image')
  assert.ok(r.sha256)
})

test('rejects oversized image', () => {
  const jpeg = buf([0xff,0xd8,0xff,0xe0, ...Array(20).fill(0)])
  const r = validateMediaBuffer(jpeg, 'image/jpeg', 11 * 1024 * 1024)
  assert.equal(r.ok, false)
  assert.equal(r.status, 413)
})

test('EBML audio/webm allowed when declared audio/webm', () => {
  assert.equal(signatureMatchesDeclared('audio/webm', 'video/webm'), true)
})

test('extForMime maps common types', () => {
  assert.equal(extForMime('image/jpeg'), 'jpg')
  assert.equal(extForMime('video/mp4'), 'mp4')
  assert.equal(extForMime('audio/mpeg'), 'mp3')
})