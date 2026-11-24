import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { errorJson, json } from '@/lib/serialize'
import { verifyTwilioWebhookSignature } from '@/lib/jara-sms-signature'

export async function POST(req: NextRequest) {
  const config = await (db as any).jaraSmsConfig.findFirst({ orderBy: { updatedAt: 'desc' } }).catch(() => null)
  if (!config || !config.enabled || !config.inboundEnabled) {
    return errorJson('Inbound SMS is not enabled.', 503)
  }
  if (String(config.provider).toLowerCase() !== 'twilio') {
    return errorJson('This webhook accepts only the configured Twilio provider.', 503)
  }
  const publicUrl = process.env.JARA_SMS_PUBLIC_WEBHOOK_URL || ''
  if (!config.webhookSecret || !publicUrl) {
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
  if (!verifyTwilioWebhookSignature({ publicUrl, authToken: config.webhookSecret, signature, params: body })) {
    return errorJson('Invalid webhook signature', 401)
  }

  const from = String(body.from || body.From || body.msisdn || '').trim()
  const to = String(body.to || body.To || '').trim()
  const text = String(body.body || body.Body || body.text || '').trim()
  const providerMessageId = String(body.messageId || body.MessageSid || body.messageId || '').trim() || null
  if (!from || !text) return errorJson('Invalid SMS payload', 400)

  const normalized = text.toUpperCase().trim()
  const optOutKeywords = (() => { try { return JSON.parse(config.optOutKeywords || '[]') } catch { return ['STOP','UNSUBSCRIBE','CANCEL'] } })()
  const isOptOut = optOutKeywords.map((k: string) => String(k).toUpperCase()).includes(normalized)

  const contact = await (db as any).jaraSmsContact.upsert({
    where: { phoneNumber: from },
    update: isOptOut ? { consentStatus: 'opted_out', optedOutAt: new Date() } : {},
    create: { phoneNumber: from, consentStatus: isOptOut ? 'opted_out' : 'unknown', optedOutAt: isOptOut ? new Date() : null },
  }).catch(() => null)

  await (db as any).jaraSmsMessage.create({
    data: {
      contactId: contact?.id || null,
      direction: 'inbound',
      fromNumber: from,
      toNumber: to || null,
      body: text.slice(0, 2000),
      status: isOptOut ? 'received' : 'received',
      provider: config.provider || 'unknown',
      providerMessageId,
      requiresApproval: false,
      consentChecked: true,
      metadata: JSON.stringify({ optOut: isOptOut, webhookReceived: true }),
    },
  }).catch(() => {})

  return json({ ok: true, optOut: isOptOut })
}