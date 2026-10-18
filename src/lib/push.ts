import { logger } from '@/lib/logger'

type WebPush = {
  setVapidDetails: (subject: string, publicKey: string, privateKey: string) => void
  sendNotification: (sub: unknown, payload: string) => Promise<unknown>
}

let _webpush: WebPush | null = null

export function initWebPush(): WebPush | null {
  if (_webpush) return _webpush
  const publicKey = process.env.VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT || 'mailto:admin@friendconnect.app'
  if (!publicKey || !privateKey) {
    logger.warn('web-push not configured — VAPID keys missing. Run: ./scripts/generate-vapid.sh')
    return null
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const webpush = require('web-push') as WebPush
    webpush.setVapidDetails(subject, publicKey, privateKey)
    _webpush = webpush
    logger.info('web-push configured', { subject })
    return webpush
  } catch (e: unknown) {
    const err = e as Error
    logger.error('web-push init failed', { error: err?.message })
    return null
  }
}

export function isPushConfigured(): boolean {
  return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY)
}

export function getVapidPublicKey(): string {
  return process.env.VAPID_PUBLIC_KEY || ''
}

export async function sendPushNotification(
  subscription: { endpoint: string; p256dh: string; auth: string },
  payload: unknown
) {
  const webpush = initWebPush()
  if (!webpush) return { ok: false, error: 'web-push not configured' }
  try {
    await webpush.sendNotification(
      { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
      JSON.stringify(payload)
    )
    return { ok: true }
  } catch (e: unknown) {
    const err = e as Error & { statusCode?: number }
    logger.error('push send failed', { error: err?.message, endpoint: subscription.endpoint.slice(0, 50) })
    return { ok: false, error: err?.message, statusCode: err?.statusCode }
  }
}
