import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { errorJson, json } from '@/lib/serialize'
import { requireSuperAdmin, writeJaraAudit, requestMeta } from '@/lib/jara-admin'
import { getSmsCapability, isValidE164, normalizeSmsProvider, sendSmsViaProvider } from '@/lib/jara-sms'

function defaultSenderNumber(provider: string, configSender?: string | null): string {
  if (configSender) return configSender.trim()
  if (provider === 'httpsms') return (process.env.HTTPSMS_FROM_NUMBER || '').trim()
  if (provider === 'telnyx') return (process.env.TELNYX_FROM_NUMBER || '').trim()
  if (provider === 'twilio') return (process.env.TWILIO_FROM_NUMBER || '').trim()
  return ''
}

export async function POST(req: NextRequest) {
  let me
  try { me = await requireSuperAdmin() } catch (e: any) { return errorJson(e.message === 'UNAUTHORIZED' ? 'Unauthorized' : 'Forbidden — Super Admin only', e.status || 403) }

  let body: any
  try { body = await req.json() } catch { return errorJson('Invalid JSON', 400) }

  const to = String(body.to || '').trim()
  const text = String(body.body || body.message || '').trim()
  const approveNow = Boolean(body.approveNow)
  if (!isValidE164(to)) return errorJson('Valid E.164 recipient phone number required (e.g. +8801712345678)', 400)
  if (!text || text.length > 1600) return errorJson('Message body required (1..1600 chars)', 400)

  const config = await (db as any).jaraSmsConfig.findFirst({ orderBy: { updatedAt: 'desc' } }).catch(() => null)
  if (!config || !config.enabled || !config.outboundEnabled) {
    return errorJson('Outbound SMS is disabled in Jara SMS configuration', 503)
  }

  const provider = normalizeSmsProvider(config.provider)
  const cap = getSmsCapability(config)
  if (provider === 'none' || !cap.outboundReady) {
    return errorJson(`SMS provider not ready (${cap.missingEnv.join(', ') || 'missing credentials'})`, 503)
  }

  const from = defaultSenderNumber(provider, config.senderId)
  if (!isValidE164(from)) {
    return errorJson('Configured senderId must be a valid E.164 phone number', 400)
  }

  if (config.allowedCountries) {
    try {
      const allowed = JSON.parse(config.allowedCountries)
      if (Array.isArray(allowed) && allowed.length > 0) {
        const matched = allowed.some((prefix: string) => to.startsWith(String(prefix).trim()))
        if (!matched) return errorJson('Recipient number prefix is outside allowedCountries', 403)
      }
    } catch {}
  }

  const contact = await (db as any).jaraSmsContact.findUnique({ where: { phoneNumber: to } }).catch(() => null)
  if (contact?.consentStatus === 'opted_out') {
    return errorJson('Recipient has opted out of SMS messages', 403)
  }

  const oneHourAgo = new Date(Date.now() - 3600_000)
  const recentCount = await (db as any).jaraSmsMessage.count({
    where: { direction: 'outbound', createdAt: { gte: oneHourAgo } },
  }).catch(() => 0)
  if (recentCount >= (config.rateLimitPerHour || 20)) {
    return errorJson('Hourly SMS rate limit exceeded', 429)
  }

  const ensuredContact = contact || await (db as any).jaraSmsContact.create({
    data: { phoneNumber: to, consentStatus: 'unknown', metadata: JSON.stringify({ createdBy: me.id }) },
  }).catch(() => null)

  const meta = requestMeta(req)
  if (config.requireHumanApproval && !approveNow) {
    const queued = await (db as any).jaraSmsMessage.create({
      data: {
        contactId: ensuredContact?.id || null,
        direction: 'outbound',
        fromNumber: from,
        toNumber: to,
        body: text,
        status: 'pending_approval',
        provider,
        requiresApproval: true,
        consentChecked: true,
        createdBy: me.id,
        metadata: JSON.stringify({ queuedBy: me.id }),
      },
    })
    await writeJaraAudit({
      action: 'sms_queued',
      actorId: me.id,
      actorRole: me.role,
      detail: `Queued SMS to ${to} via ${provider} pending human approval`,
      newValue: { messageId: queued.id, to, provider },
      authorizationResult: 'allowed',
      ...meta,
    })
    return json({ queued: true, message: queued }, 202)
  }

  const result = await sendSmsViaProvider({ provider, from, to, body: text, webhookSecret: config.webhookSecret })
  const saved = await (db as any).jaraSmsMessage.create({
    data: {
      contactId: ensuredContact?.id || null,
      direction: 'outbound',
      fromNumber: from,
      toNumber: to,
      body: text,
      status: result.status,
      provider,
      providerMessageId: result.providerMessageId,
      requiresApproval: false,
      approvedBy: approveNow ? me.id : null,
      approvedAt: approveNow ? new Date() : null,
      consentChecked: true,
      createdBy: me.id,
      metadata: JSON.stringify({ error: result.error || null }),
    },
  })

  await writeJaraAudit({
    action: result.ok ? 'sms_sent' : 'sms_failed',
    actorId: me.id,
    actorRole: me.role,
    detail: result.ok ? `Sent SMS to ${to} via ${provider}` : `SMS send failed (${provider}): ${result.error}`,
    newValue: { messageId: saved.id, providerMessageId: result.providerMessageId, status: saved.status },
    authorizationResult: result.ok ? 'allowed' : 'error',
    ...meta,
  })

  if (!result.ok) return errorJson(result.error || 'SMS send failed', result.httpStatus || 502)
  return json({ ok: true, message: saved })
}

export async function PATCH(req: NextRequest) {
  let me
  try { me = await requireSuperAdmin() } catch (e: any) { return errorJson(e.message === 'UNAUTHORIZED' ? 'Unauthorized' : 'Forbidden — Super Admin only', e.status || 403) }

  let body: any
  try { body = await req.json() } catch { return errorJson('Invalid JSON', 400) }
  const id = String(body.id || '').trim()
  const action = String(body.action || '').trim()
  if (!id || !['approve', 'reject'].includes(action)) {
    return errorJson('id and action (approve|reject) required', 400)
  }

  const existing = await (db as any).jaraSmsMessage.findUnique({ where: { id } }).catch(() => null)
  if (!existing) return errorJson('SMS message not found', 404)
  if (existing.status !== 'pending_approval') {
    return errorJson(`Message is already ${existing.status}`, 400)
  }

  const meta = requestMeta(req)
  if (action === 'reject') {
    const updated = await (db as any).jaraSmsMessage.update({
      where: { id },
      data: { status: 'rejected', approvedBy: me.id, approvedAt: new Date() },
    })
    await writeJaraAudit({ action: 'sms_rejected', actorId: me.id, actorRole: me.role, detail: `Rejected SMS ${id} to ${existing.toNumber}`, authorizationResult: 'allowed', ...meta })
    return json({ ok: true, message: updated })
  }

  const contact = existing.toNumber
    ? await (db as any).jaraSmsContact.findUnique({ where: { phoneNumber: existing.toNumber } }).catch(() => null)
    : null
  if (contact?.consentStatus === 'opted_out') {
    const updated = await (db as any).jaraSmsMessage.update({ where: { id }, data: { status: 'rejected' } })
    return errorJson('Recipient opted out before approval; rejected', 403)
  }

  const config = await (db as any).jaraSmsConfig.findFirst({ orderBy: { updatedAt: 'desc' } }).catch(() => null)
  if (!config || !config.enabled || !config.outboundEnabled) {
    return errorJson('Outbound SMS is currently disabled', 503)
  }
  const provider = normalizeSmsProvider(config.provider)
  const cap = getSmsCapability(config)
  if (!cap.outboundReady) {
    return errorJson(`SMS provider not ready (${cap.missingEnv.join(', ')})`, 503)
  }

  const from = existing.fromNumber || defaultSenderNumber(provider, config.senderId)
  const result = await sendSmsViaProvider({
    provider,
    from,
    to: existing.toNumber,
    body: existing.body,
    webhookSecret: config.webhookSecret,
  })
  const updated = await (db as any).jaraSmsMessage.update({
    where: { id },
    data: {
      status: result.status,
      providerMessageId: result.providerMessageId,
      approvedBy: me.id,
      approvedAt: new Date(),
      metadata: JSON.stringify({ error: result.error || null }),
    },
  })
  await writeJaraAudit({
    action: result.ok ? 'sms_sent' : 'sms_failed',
    actorId: me.id,
    actorRole: me.role,
    detail: result.ok ? `Approved & sent SMS ${id} to ${existing.toNumber} via ${provider}` : `Approved SMS ${id} failed: ${result.error}`,
    authorizationResult: result.ok ? 'allowed' : 'error',
    ...meta,
  })
  if (!result.ok) return errorJson(result.error || 'SMS send failed', result.httpStatus || 502)
  return json({ ok: true, message: updated })
}
