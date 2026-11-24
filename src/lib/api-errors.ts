/**
 * Shared route error handling.
 *
 * Findings #15 (and part of #5): routes were returning raw `error.message` to
 * the client in 77 files, which leaked SQLite/Prisma internals — table and
 * column names, constraint names, occasionally absolute file paths — and made
 * every unexpected failure a 500 with a body the client cannot act on.
 *
 * Contract for clients:
 *   { error: string, code: string, requestId: string }
 *
 * `error` is always a short, safe, human-readable sentence. `code` is a stable
 * machine-readable identifier. The detail an operator needs is written to the
 * server log, correlated by `requestId`, and never sent to the browser.
 */

import { randomUUID } from 'crypto'
import { logger } from '@/lib/logger'
import { json } from '@/lib/serialize'

export type ErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_FAILED'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'SERVICE_UNAVAILABLE'
  | 'INTERNAL_ERROR'

const DEFAULT_MESSAGE: Record<ErrorCode, string> = {
  UNAUTHORIZED: 'Authentication required.',
  FORBIDDEN: 'You do not have permission to do that.',
  NOT_FOUND: 'Not found.',
  VALIDATION_FAILED: 'The request was invalid.',
  CONFLICT: 'That action conflicts with the current state.',
  RATE_LIMITED: 'Too many requests. Please try again shortly.',
  PAYLOAD_TOO_LARGE: 'That payload is too large.',
  UNSUPPORTED_MEDIA_TYPE: 'That file type is not supported.',
  SERVICE_UNAVAILABLE: 'This service is temporarily unavailable.',
  INTERNAL_ERROR: 'Something went wrong on our end.',
}

const STATUS_FOR_CODE: Record<ErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 400,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  SERVICE_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
}

/** An error a route throws deliberately, with a message safe to publish. */
export class RouteError extends Error {
  status: number
  code: ErrorCode
  publicMessage: string

  constructor(code: ErrorCode, publicMessage?: string, status?: number) {
    const message = publicMessage ?? DEFAULT_MESSAGE[code]
    super(message)
    this.name = 'RouteError'
    this.code = code
    this.status = status ?? STATUS_FOR_CODE[code]
    this.publicMessage = message
  }
}

export const unauthorized = (message?: string) => new RouteError('UNAUTHORIZED', message)
export const forbidden = (message?: string) => new RouteError('FORBIDDEN', message)
export const notFound = (message?: string) => new RouteError('NOT_FOUND', message)
export const invalid = (message?: string) => new RouteError('VALIDATION_FAILED', message)
export const conflict = (message?: string) => new RouteError('CONFLICT', message)

/**
 * Patterns that indicate an internal detail we must never echo. Used as a
 * second line of defence when a thrown message is passed through deliberately.
 */
const LEAKY_PATTERNS = [
  /SQLITE_/i,
  /SqliteError/i,
  /prisma\./i,
  /Invalid `prisma/i,
  /no such table/i,
  /no such column/i,
  /UNIQUE constraint/i,
  /FOREIGN KEY constraint/i,
  /NOT NULL constraint/i,
  /constraint failed/i,
  /duplicate column name/i,
  /at .*\(.*:\d+:\d+\)/, // stack frame
  /\/(?:home|usr|var|tmp)\//, // absolute paths
  /\.prisma/i,
]

export function isLeakyMessage(message: string): boolean {
  return LEAKY_PATTERNS.some((pattern) => pattern.test(message))
}

/**
 * Turn any thrown value into a safe JSON response and log the real cause.
 *
 * @param error    whatever was caught
 * @param context  a short label such as "POST /api/messages" for the log
 */
export function handleRouteError(error: unknown, context: string) {
  const requestId = randomUUID()

  // Deliberate, already-safe errors pass straight through.
  if (error instanceof RouteError) {
    if (error.status >= 500) {
      logger.error('route error', { context, requestId, code: error.code, error: error.message })
    } else {
      logger.warn('route rejected', { context, requestId, code: error.code, error: error.message })
    }
    return json({ error: error.publicMessage, code: error.code, requestId }, error.status)
  }

  // The auth helpers throw Error('UNAUTHORIZED') / Error('FORBIDDEN').
  if (error instanceof Error && (error.message === 'UNAUTHORIZED' || error.message === 'FORBIDDEN')) {
    const code: ErrorCode = error.message === 'UNAUTHORIZED' ? 'UNAUTHORIZED' : 'FORBIDDEN'
    return json({ error: DEFAULT_MESSAGE[code], code, requestId }, STATUS_FOR_CODE[code])
  }

  const detail = error instanceof Error ? error.message : String(error)
  const stack = error instanceof Error ? error.stack : undefined

  logger.error('unhandled route error', {
    context,
    requestId,
    error: detail,
    stack: stack?.split('\n').slice(0, 6).join(' | '),
  })

  // Anything recognised as a database/internal failure is reported generically.
  // Unknown messages are also generic: we cannot prove they are safe.
  return json(
    {
      error: DEFAULT_MESSAGE.INTERNAL_ERROR,
      code: 'INTERNAL_ERROR' as ErrorCode,
      requestId,
    },
    500,
  )
}

/** Convenience: rethrow a RouteError so `handleRouteError` formats it. */
export function assertOrThrow(condition: unknown, code: ErrorCode, message?: string): asserts condition {
  if (!condition) throw new RouteError(code, message)
}
