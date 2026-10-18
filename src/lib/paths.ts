import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'

export function uploadDir(): string {
  const dir = process.env.UPLOAD_DIR || join(/*turbopackIgnore: true*/ process.cwd(), 'upload')
  if (!existsSync(/*turbopackIgnore: true*/ dir)) mkdirSync(/*turbopackIgnore: true*/ dir, { recursive: true })
  return dir
}

export function realtimeUrl(): string {
  return process.env.SOCKET_INTERNAL_URL || `http://127.0.0.1:${process.env.SOCKET_PORT || 3003}`
}

export function appOrigin(): string {
  return process.env.APP_ORIGIN || process.env.NEXTAUTH_URL || 'http://localhost:3000'
}
