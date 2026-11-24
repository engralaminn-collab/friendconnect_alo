import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { errorJson, json } from '@/lib/serialize'
import { handleRouteError } from '@/lib/api-errors'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const me = await getSessionUser()
    if (!me) return errorJson('Unauthorized', 401)
    const { id } = await params
    const body = await req.json()
    const targetId = String(body.userId || '')
    if (!targetId) return errorJson('userId required', 400)
    const membership = await db.groupMember.findUnique({
      where: { groupId_userId: { groupId: id, userId: me.id } },
    })
    if (!membership || (membership.role !== 'OWNER' && membership.role !== 'ADMIN')) {
      return errorJson('Only owner/admin can add members', 403)
    }
    await db.groupMember.upsert({
      where: { groupId_userId: { groupId: id, userId: targetId } },
      update: {},
      create: { groupId: id, userId: targetId, role: 'MEMBER' },
    })
    return json({ ok: true })
  } catch (error) {
    return handleRouteError(error, '/api/groups/[id]/members')
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const me = await getSessionUser()
    if (!me) return errorJson('Unauthorized', 401)
    const { id } = await params
    const url = new URL(req.url)
    const targetId = url.searchParams.get('userId') || me.id

    // Caller must be a member of the group.
    const myMembership = await db.groupMember.findUnique({
      where: { groupId_userId: { groupId: id, userId: me.id } },
    })
    if (!myMembership) return errorJson('Not a member', 403)

    // Leaving voluntarily is always allowed; removing someone else needs OWNER/ADMIN.
    const removingOther = targetId !== me.id
    if (removingOther && myMembership.role !== 'OWNER' && myMembership.role !== 'ADMIN') {
      return errorJson('Only owner/admin can remove other members', 403)
    }

    // The group owner can never be removed by another member.
    const target = await db.groupMember.findUnique({
      where: { groupId_userId: { groupId: id, userId: targetId } },
    })
    if (!target) return errorJson('Member not found', 404)
    if (target.role === 'OWNER' && removingOther) {
      return errorJson('The group owner cannot be removed', 403)
    }

    await db.groupMember.deleteMany({ where: { groupId: id, userId: targetId } })
    return json({ ok: true })
  } catch (error) {
    return handleRouteError(error, '/api/groups/[id]/members')
  }
}
