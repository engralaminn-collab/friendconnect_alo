'use strict'

/**
 * Audit finding 27: HTTP Range parsing for downloads.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('fs')
const { join } = require('path')
const { parseRange } = require('../../src/lib/http-range.cjs')

test('no Range header serves the full representation', () => {
  assert.deepEqual(parseRange(null, 100), { type: 'full' })
  assert.deepEqual(parseRange('', 100), { type: 'full' })
})

test('explicit, open-ended and suffix ranges are resolved to inclusive offsets', () => {
  assert.deepEqual(parseRange('bytes=0-9', 100), { type: 'partial', start: 0, end: 9 })
  assert.deepEqual(parseRange('bytes=10-', 100), { type: 'partial', start: 10, end: 99 })
  assert.deepEqual(parseRange('bytes=-20', 100), { type: 'partial', start: 80, end: 99 })
})

test('an end beyond the file is clamped to the last byte', () => {
  assert.deepEqual(parseRange('bytes=90-500', 100), { type: 'partial', start: 90, end: 99 })
})

test('a start at or past the end, a reversed range, or a zero suffix is unsatisfiable', () => {
  assert.deepEqual(parseRange('bytes=100-', 100), { type: 'unsatisfiable' })
  assert.deepEqual(parseRange('bytes=50-10', 100), { type: 'unsatisfiable' })
  assert.deepEqual(parseRange('bytes=-0', 100), { type: 'unsatisfiable' })
  assert.deepEqual(parseRange('bytes=0-0', 0), { type: 'unsatisfiable' })
})

test('multi-range and malformed headers are ignored rather than served as partial content', () => {
  assert.deepEqual(parseRange('bytes=0-1,5-6', 100), { type: 'full' })
  assert.deepEqual(parseRange('items=0-1', 100), { type: 'full' })
  assert.deepEqual(parseRange('bytes=-', 100), { type: 'full' })
  assert.deepEqual(parseRange('bytes=abc', 100), { type: 'full' })
})

test('the download route answers 206 and 416 from the parser', () => {
  const src = readFileSync(join(__dirname, '../../src/app/api/files/[id]/route.ts'), 'utf8')
  assert.match(src, /parseRange\(req\.headers\.get\('range'\)/)
  assert.match(src, /status: 206/)
  assert.match(src, /status: 416/)
  assert.match(src, /accept-ranges/)
})
