import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { errorJson, json } from '@/lib/serialize'

export async function POST(req: NextRequest) {
  const config = await (db as any).jaraSmsConfig.findFirst({ orderBy: { updatedAt: 'desc' } }).catch(() => null)
  if (!config || !config.enabled) {
    return errorJson('SMS provider not configured — webhook cannot be processed.', 503)
  }

  // Basic webhook structure: provider signature verification must be implemented per provider.
  // Without verified provider signature, do not trust payload.
  const signature = req.headers.get('x-twilio-signature') || req.headers.get('x-vonage-signature') || req.headers.get('x-sms-signature')
  if (config.webhookSecret && !signature) {
    return errorJson('Missing webhook signature', 401)
  }

  let body: any
  const ct = req.headers.get('content-type') || ''
  try {
    body = ct.includes('application/json') ? await req.json() : Object.fromEntries((await req.formData()).entries())
  } catch { return errorJson('Invalid payload', 400) }

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