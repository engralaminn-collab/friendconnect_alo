import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { errorJson, json } from '@/lib/serialize'
import {
  verifyHttpSmsWebhookAuth,
  verifyTelnyxWebhookSignature,
  verifyTwilioWebhookSignature,
} from '@/lib/jara-sms-signature'

async function recordInboundSms(config: any, payload: {
  from: string
  to: string
  text: string
  providerMessageId: string | null
  provider: string
}) {
  const normalized = payload.text.toUpperCase().trim()
  const optOutKeywords = (() => {
    try { return JSON.parse(config.optOutKeywords || '[]') } catch { return ['STOP', 'UNSUBSCRIBE', 'CANCEL'] }
  })()
  const isOptOut = optOutKeywords.map((k: string) => String(k).toUpperCase()).includes(normalized)

  const contact = await (db as any).jaraSmsContact.upsert({
    where: { phoneNumber: payload.from },
    update: isOptOut ? { consentStatus: 'opted_out', optedOutAt: new Date() } : {},
    create: {
      phoneNumber: payload.from,
      consentStatus: isOptOut ? 'opted_out' : 'unknown',
      optedOutAt: isOptOut ? new Date() : null,
    },
  }).catch(() => null)

  await (db as any).jaraSmsMessage.create({
    data: {
      contactId: contact?.id || null,
      direction: 'inbound',
      fromNumber: payload.from,
      toNumber: payload.to || null,
      body: payload.text.slice(0, 2000),
      status: 'received',
      provider: payload.provider,
      providerMessageId: payload.providerMessageId,
      requiresApproval: false,
      consentChecked: true,
      metadata: JSON.stringify({ optOut: isOptOut, webhookReceived: true }),
    },
  }).catch(() => {})

  return isOptOut
}

export async function POST(req: NextRequest) {
  const config = await (db as any).jaraSmsConfig.findFirst({ orderBy: { updatedAt: 'desc' } }).catch(() => null)
  if (!config || !config.enabled || !config.inboundEnabled) {
    return errorJson('Inbound SMS is not enabled.', 503)
  }

  const provider = String(config.provider || '').toLowerCase()

  if (provider === 'twilio') {
    const publicUrl = process.env.JARA_SMS_PUBLIC_WEBHOOK_URL || (process.env.JARA_SMS_WEBHOOK_BASE_URL ? `${process.env.JARA_SMS_WEBHOOK_BASE_URL.replace(/\/+$/, '')}/api/jara/sms/webhook` : '')
    const authToken = config.webhookSecret || process.env.TWILIO_AUTH_TOKEN || ''
    if (!authToken || !publicUrl) {
      return errorJson('Twilio webhook verification is not configured.', 503)
    }
    if (!(req.headers.get('content-type') || '').toLowerCase().includes('application/x-www-form-urlencoded')) {
      return errorJson('Only form-encoded Twilio webhooks are supported.', 415)
    }

    let body: Record<string, string>
    try {
      const form = await req.formData()
      body = {}
      for (const [key, value] of form.entries()) {
        if (typeof value !== 'string' || Object.hasOwn(body, key)) return errorJson('Invalid or duplicate form field', 400)
        body[key] = value
      }
    } catch { return errorJson('Invalid payload', 400) }

    const signature = req.headers.get('x-twilio-signature') || ''
    if (!verifyTwilioWebhookSignature({ publicUrl, authToken, signature, params: body })) {
      return errorJson('Invalid webhook signature', 401)
    }

    const from = String(body.from || body.From || body.msisdn || '').trim()
    const to = String(body.to || body.To || '').trim()
    const text = String(body.body || body.Body || body.text || '').trim()
    const providerMessageId = String(body.messageId || body.MessageSid || '').trim() || null
    if (!from || !text) return errorJson('Invalid SMS payload', 400)

    const optOut = await recordInboundSms(config, { from, to, text, providerMessageId, provider: 'twilio' })
    return json({ ok: true, optOut })
  }

  if (provider === 'httpsms') {
    const secret = process.env.HTTPSMS_WEBHOOK_SECRET || process.env.HTTPSMS_WEBHOOK_SIGNING_KEY || config.webhookSecret || ''
    if (!secret) return errorJson('httpSMS webhook secret is not configured.', 503)
    const ok = verifyHttpSmsWebhookAuth({
      secret,
      authorizationHeader: req.headers.get('authorization'),
      secretHeader: req.headers.get('x-webhook-secret') || req.headers.get('x-httpsms-secret'),
    })
    if (!ok) return errorJson('Invalid webhook signature', 401)

    const payload: any = await req.json().catch(() => null)
    if (!payload) return errorJson('Invalid JSON payload', 400)
    const eventType = String(payload.type || '')
    if (eventType && eventType !== 'message.phone.received') {
      return json({ ok: true, ignored: eventType })
    }
    const data = payload.data || payload
    const from = String(data.contact || data.from || '').trim()
    const to = String(data.owner || data.to || '').trim()
    const text = String(data.content || data.body || '').trim()
    const providerMessageId = String(data.message_id || data.id || payload.id || '').trim() || null
    if (!from || !text) return errorJson('Invalid httpSMS payload', 400)

    const optOut = await recordInboundSms(config, { from, to, text, providerMessageId, provider: 'httpsms' })
    return json({ ok: true, optOut })
  }

  if (provider === 'telnyx') {
    const publicKey = process.env.TELNYX_PUBLIC_KEY || config.webhookSecret || ''
    if (!publicKey) return errorJson('Telnyx public key is not configured.', 503)
    const rawBody = await req.text()
    const signatureBase64 = req.headers.get('telnyx-signature-ed25519') || ''
    const timestamp = req.headers.get('telnyx-timestamp') || ''
    if (!verifyTelnyxWebhookSignature({ publicKey, signatureBase64, timestamp, rawBody })) {
      return errorJson('Invalid Telnyx webhook signature', 401)
    }

    let parsed: any
    try { parsed = JSON.parse(rawBody) } catch { return errorJson('Invalid JSON payload', 400) }
    const eventType = String(parsed?.data?.event_type || '')
    if (eventType !== 'message.received') {
      return json({ ok: true, ignored: eventType })
    }
    const msg = parsed?.data?.payload || {}
    const from = String(msg?.from?.phone_number || '').trim()
    const to = String(msg?.to?.[0]?.phone_number || '').trim()
    const text = String(msg?.text || '').trim()
    const providerMessageId = String(msg?.id || parsed?.data?.id || '').trim() || null
    if (!from || !text) return errorJson('Invalid Telnyx SMS payload', 400)

    const optOut = await recordInboundSms(config, { from, to, text, providerMessageId, provider: 'telnyx' })
    return json({ ok: true, optOut })
  }

  return errorJson('Configured SMS provider does not support inbound webhooks.', 503)
}
