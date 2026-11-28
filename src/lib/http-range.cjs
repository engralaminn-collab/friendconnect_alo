'use strict'

/**
 * Single-range HTTP `Range` parsing for file downloads (audit finding 27).
 *
 * Supports `bytes=start-end`, `bytes=start-` and suffix `bytes=-n`. Multi-range
 * requests are not served as multipart; they are treated as "no usable range" and
 * the full representation is returned, which RFC 9110 permits.
 *
 * Returns:
 *   { type: 'full' }                      — no Range header or ignorable syntax
 *   { type: 'partial', start, end }       — inclusive byte offsets, satisfiable
 *   { type: 'unsatisfiable' }             — respond 416
 */

const SIMPLE_RANGE = /^bytes=(\d*)-(\d*)$/

/**
 * @typedef {{ type: 'full' } | { type: 'partial', start: number, end: number } | { type: 'unsatisfiable' }} ByteRange
 */

/**
 * @param {string | null | undefined} header
 * @param {number} size
 * @returns {ByteRange}
 */
function parseRange(header, size) {
  if (!header) return { type: 'full' }
  const raw = String(header).trim()
  if (raw.includes(',')) return { type: 'full' }
  const match = SIMPLE_RANGE.exec(raw)
  if (!match) return { type: 'full' }

  const [, startText, endText] = match
  if (startText === '' && endText === '') return { type: 'full' }

  if (size <= 0) return { type: 'unsatisfiable' }

  let start
  let end
  if (startText === '') {
    // Suffix range: the last N bytes.
    const suffix = Number(endText)
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return { type: 'unsatisfiable' }
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(startText)
    end = endText === '' ? size - 1 : Math.min(Number(endText), size - 1)
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return { type: 'unsatisfiable' }
    if (start >= size || (endText !== '' && Number(endText) < start)) return { type: 'unsatisfiable' }
  }
  return { type: 'partial', start, end }
}

module.exports = { parseRange }
