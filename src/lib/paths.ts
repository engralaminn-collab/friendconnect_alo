import { existsSync, mkdirSync } from 'fs'
import { join, resolve, isAbsolute } from 'path'

/**
 * Project root. The Next.js standalone server chdir()s into `.next/standalone`; resolving
 * relative paths against cwd there put uploads inside the build folder (wiped by every
 * `npm run build`) instead of the real ./upload directory. See db-runtime.js appRoot().
 */
export function appRoot(): string {
  if (process.env.APP_DIR) return resolve(/*turbopackIgnore: true*/ process.env.APP_DIR)
  const cwd = process.cwd()
  if (/[\\/]\.next[\\/]standalone$/.test(cwd)) return resolve(/*turbopackIgnore: true*/ cwd, '..', '..')
  return cwd
}

export function uploadDir(): string {
  const configured = process.env.UPLOAD_DIR
  const dir = configured
    ? isAbsolute(configured)
      ? configured
      : resolve(/*turbopackIgnore: true*/ appRoot(), configured)
    : join(/*turbopackIgnore: true*/ appRoot(), 'upload')
  if (!existsSync(/*turbopackIgnore: true*/ dir)) mkdirSync(/*turbopackIgnore: true*/ dir, { recursive: true })
  return dir
}

export function realtimeUrl(): string {
  return process.env.SOCKET_INTERNAL_URL || `http://127.0.0.1:${process.env.SOCKET_PORT || 3003}`
}

export function appOrigin(): string {
  return process.env.APP_ORIGIN || process.env.NEXTAUTH_URL || 'http://localhost:3000'
}
