import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { errorJson, json } from '@/lib/serialize'
import { requireSuperAdmin, writeJaraAudit, requestMeta } from '@/lib/jara-admin'
import { getSmsCapability, normalizeSmsProvider } from '@/lib/jara-sms'

export async function GET() {
  try { await requireSuperAdmin() } catch (e: any) { return errorJson(e.message === 'UNAUTHORIZED' ? 'Unauthorized' : 'Forbidden — Super Admin only', e.status || 403) }
  const [config, messages] = await Promise.all([
    (db as any).jaraSmsConfig.findFirst({ orderBy: { updatedAt: 'desc' } }).catch(() => null),
    (db as any).jaraSmsMessage.findMany({ orderBy: { createdAt: 'desc' }, take: 50 }).catch(() => []),
  ])
  return json({
    config: config ? { ...config, webhookSecret: config.webhookSecret ? '[redacted]' : null } : null,
    capability: getSmsCapability(config),
    messages,
  })
}

export async function POST(req: NextRequest) {
  let me
  try { me = await requireSuperAdmin() } catch (e: any) { return errorJson(e.message === 'UNAUTHORIZED' ? 'Unauthorized' : 'Forbidden — Super Admin only', e.status || 403) }
  let body: any
  try { body = await req.json() } catch { return errorJson('Invalid JSON', 400) }

  const existing = await (db as any).jaraSmsConfig.findFirst({ orderBy: { updatedAt: 'desc' } }).catch(() => null)
  const provider = normalizeSmsProvider(body.provider || existing?.provider || 'none')
  const data: any = {
    enabled: Boolean(body.enabled),
    provider,
    senderId: body.senderId ? String(body.senderId).slice(0, 80) : null,
    webhookSecret: body.webhookSecret && body.webhookSecret !== '[redacted]'
      ? String(body.webhookSecret).slice(0, 200)
      : existing?.webhookSecret || null,
    inboundEnabled: Boolean(body.inboundEnabled),
    outboundEnabled: Boolean(body.outboundEnabled),
    requireHumanApproval: body.requireHumanApproval !== false,
    allowedCountries: body.allowedCountries ? (typeof body.allowedCountries === 'string' ? body.allowedCountries : JSON.stringify(body.allowedCountries)) : null,
    rateLimitPerHour: Math.max(1, Number(body.rateLimitPerHour || 20)),
    optOutKeywords: body.optOutKeywords ? (typeof body.optOutKeywords === 'string' ? body.optOutKeywords : JSON.stringify(body.optOutKeywords)) : JSON.stringify(['STOP', 'UNSUBSCRIBE', 'CANCEL']),
    updatedBy: me.id,
  }
  const config = existing
    ? await (db as any).jaraSmsConfig.update({ where: { id: existing.id }, data })
    : await (db as any).jaraSmsConfig.create({ data: { ...data, createdBy: me.id } })

  const meta = requestMeta(req)
  await writeJaraAudit({
    action: 'config_change',
    actorId: me.id,
    actorRole: me.role,
    detail: `Updated SMS config provider=${config.provider} enabled=${config.enabled}`,
    previousValue: existing ? { enabled: existing.enabled, provider: existing.provider } : null,
    newValue: { enabled: config.enabled, provider: config.provider },
    authorizationResult: 'allowed',
    ...meta,
  })
  return json({
    config: { ...config, webhookSecret: config.webhookSecret ? '[redacted]' : null },
    capability: getSmsCapability(config),
  })
}
