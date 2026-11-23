import { NextRequest } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { errorJson, json } from '@/lib/serialize'
import { db } from '@/lib/db'
import { JARA_ID } from '@/lib/jara'

// GET /api/jara/group/consent?groupId=xxx — check consent
export async function GET(req: NextRequest) {
  const me = await getSessionUser()
  if (!me) return errorJson('Unauthorized', 401)
  const groupId = req.nextUrl.searchParams.get('groupId')
  if (!groupId) return errorJson('groupId required', 400)

  const consent = await (db as any).jaraGroupConsent.findUnique({ where: { groupId } }).catch(() => null)
  const jaraMember = await (db as any).groupMember.findUnique({ where: { groupId_userId: { groupId, userId: JARA_ID } } }).catch(() => null)

  return json({ consent: consent || { groupId, enabled: false, listenEnabled: false }, isMember: !!jaraMember })
}

// POST /api/jara/group/consent — enable/disable Jara in group (admin only)
export async function POST(req: NextRequest) {
  const me = await getSessionUser()
  if (!me) return errorJson('Unauthorized', 401)

  let body: any
  try { body = await req.json() } catch { return errorJson('Invalid JSON', 400) }

  const groupId: string = body.groupId
  const enabled: boolean = body.enabled ?? true
  const listenEnabled: boolean = body.listenEnabled ?? false

  if (!groupId) return errorJson('groupId required', 400)

  const membership = await (db as any).groupMember.findUnique({
    where: { groupId_userId: { groupId, userId: me.id } },
  }).catch(() => null)
  if (!membership) return errorJson('Not a member', 403)
  if (!['owner', 'admin', 'OWNER', 'ADMIN'].includes(membership.role)) {
    return errorJson('Only group admins can manage Jara', 403)
  }

  const consent = await (db as any).jaraGroupConsent.upsert({
    where: { groupId },
    update: {
      enabled,
      listenEnabled: enabled ? listenEnabled : false,
      consentedBy: me.id,
      consentedAt: new Date(),
    },
    create: {
      groupId,
      enabled,
      listenEnabled: enabled ? listenEnabled : false,
      consentedBy: me.id,
      consentedAt: new Date(),
    },
  })

  // Also add/remove Jara as group member
  if (enabled) {
    const exists = await (db as any).groupMember.findUnique({ where: { groupId_userId: { groupId, userId: JARA_ID } } }).catch(() => null)
    if (!exists) {
      await (db as any).groupMember.create({ data: { groupId, userId: JARA_ID, role: 'member' } })
    }
  } else {
    await (db as any).groupMember.deleteMany({ where: { groupId, userId: JARA_ID } }).catch(() => null)
  }

  await (db as any).jaraAuditLog.create({
    data: {
      action: enabled ? 'group_enable' : 'group_disable',
      actorId: me.id,
      actorRole: me.role,
      detail: `Jara ${enabled ? 'enabled' : 'disabled'} in group ${groupId} (listen=${listenEnabled})`,
      ip: req.headers.get('x-forwarded-for') || 'unknown',
    },
  }).catch(() => null)

  return json({ consent })
}
