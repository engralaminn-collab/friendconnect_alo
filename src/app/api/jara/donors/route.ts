import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { errorJson, json } from '@/lib/serialize'
import { requireSuperAdmin, writeJaraAudit, requestMeta } from '@/lib/jara-admin'
import { rateLimit } from '@/lib/cache'

export async function GET(req: NextRequest) {
  try { await requireSuperAdmin() } catch (e: any) { return errorJson(e.message === 'UNAUTHORIZED' ? 'Unauthorized' : 'Forbidden — Super Admin only', e.status || 403) }
  const status = req.nextUrl.searchParams.get('status')
  const where: any = {}
  if (status) where.status = status
  const donors = await (db as any).jaraDonorContribution.findMany({ where, orderBy: { createdAt: 'desc' }, take: 100 }).catch(() => [])
  return json({ donors })
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown'
  const limited = await rateLimit(`jara-donor:${ip}`, 5, 3600).catch(() => false)
  if (limited === false) return errorJson('Rate limit exceeded. Please try later.', 429)

  let body: any
  try { body = await req.json() } catch { return errorJson('Invalid JSON', 400) }

  const fullName = String(body.fullName || '').trim().slice(0, 120)
  const email = String(body.email || '').trim().toLowerCase().slice(0, 200)
  const country = body.country ? String(body.country).slice(0, 80) : null
  const contributionType = String(body.contributionType || 'support').slice(0, 40)
  const amount = body.amount ? String(body.amount).slice(0, 40) : null
  const currency = body.currency ? String(body.currency).slice(0, 10) : null
  const message = body.message ? String(body.message).slice(0, 1000) : null
  const consentToContact = Boolean(body.consentToContact)
  const privacyAccepted = Boolean(body.privacyAccepted)

  if (!fullName) return errorJson('fullName required', 400)
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return errorJson('valid email required', 400)
  if (!privacyAccepted) return errorJson('privacyAccepted required', 400)

  const allowedTypes = ['monetary', 'non_monetary', 'volunteer', 'other', 'support']
  const safeType = allowedTypes.includes(contributionType) ? contributionType : 'support'

  const record = await (db as any).jaraDonorContribution.create({
    data: {
      fullName, email, country, contributionType: safeType, amount, currency, message,
      consentToContact, privacyAccepted, status: 'pending_review', isPublic: false,
    },
  }).catch((e: any) => { throw e })

  return json({ ok: true, id: record.id, status: record.status, message: 'Thank you for supporting Jara AI. Your submission is pending review.' }, 201)
}

export async function PATCH(req: NextRequest) {
  let me
  try { me = await requireSuperAdmin() } catch (e: any) { return errorJson(e.message === 'UNAUTHORIZED' ? 'Unauthorized' : 'Forbidden — Super Admin only', e.status || 403) }
  let body: any
  try { body = await req.json() } catch { return errorJson('Invalid JSON', 400) }
  const id = String(body.id || '')
  if (!id) return errorJson('id required', 400)
  const existing = await (db as any).jaraDonorContribution.findUnique({ where: { id } }).catch(() => null)
  if (!existing) return errorJson('Not found', 404)

  const data: any = {}
  if (body.status) data.status = String(body.status).slice(0, 40)
  if (body.adminNotes !== undefined) data.adminNotes = body.adminNotes ? String(body.adminNotes).slice(0, 2000) : null
  if (data.status === 'verified') { data.verifiedBy = me.id; data.verifiedAt = new Date() }
  if (data.status === 'acknowledged') { data.acknowledgementSentAt = new Date() }

  const updated = await (db as any).jaraDonorContribution.update({ where: { id }, data })
  const meta = requestMeta(req)
  await writeJaraAudit({ action: 'config_change', actorId: me.id, actorRole: me.role, detail: `Updated donor contribution ${id} status=${updated.status}`, previousValue: { status: existing.status }, newValue: { status: updated.status }, authorizationResult: 'allowed', ...meta })
  return json({ donor: updated })
}