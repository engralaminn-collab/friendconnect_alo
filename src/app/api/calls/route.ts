import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { errorJson, json } from '@/lib/serialize'
import { canInteract } from '@/lib/socket-security.cjs'
import { handleRouteError } from '@/lib/api-errors'

export async function GET() {
  try {
    const me = await getSessionUser()
    if (!me) return errorJson('Unauthorized', 401)
    const calls = await db.call.findMany({
      where: { OR: [{ callerId: me.id }, { receiverId: me.id }] },
      orderBy: { startedAt: 'desc' },
      take: 50,
      include: { caller: { include: { profile: true } }, receiver: { include: { profile: true } } },
    })
    return json({
      calls: calls.map((c) => ({
        id: c.id,
        type: c.type,
        status: c.status,
        direction: c.callerId === me.id ? 'outgoing' : 'incoming',
        peerId: c.callerId === me.id ? c.receiverId : c.callerId,
        peerName: (c.callerId === me.id ? c.receiver?.name : c.caller?.name) || 'User',
        peerPhoto: c.callerId === me.id ? c.receiver?.profile?.photoUrl ?? null : c.caller?.profile?.photoUrl ?? null,
        startedAt: c.startedAt.toISOString(),
        endedAt: c.endedAt?.toISOString() ?? null,
        duration: c.duration ?? null,
      })),
    })
  } catch (error) {
    return handleRouteError(error, '/api/calls')
  }
}

export async function POST(req: NextRequest) {
  try {
    const me = await getSessionUser()
    if (!me) return errorJson('Unauthorized', 401)
    const body = await req.json()
    const action = String(body.action || '')
    if (action === 'start') {
      const receiverId = String(body.receiverId || '')
      const type = body.type === 'video' ? 'video' : 'audio'
      if (!receiverId || receiverId === me.id) return errorJson('Valid receiverId required', 400)
      if (!(await canInteract(db, me.id, receiverId, 'callPermission'))) return errorJson('Call not permitted', 403)
      const busy = await db.call.findFirst({
        where: {
          status: { in: ['ringing', 'connected'] },
          OR: [{ callerId: me.id }, { receiverId: me.id }, { callerId: receiverId }, { receiverId }],
        },
        select: { id: true },
      })
      if (busy) return errorJson('One participant is already in a call', 409)
      const call = await db.call.create({
        data: { callerId: me.id, receiverId, type, status: 'ringing' },
      })
      await db.notification.create({
        data: {
          userId: receiverId,
          type: 'call',
          title: `Incoming ${type} call`,
          body: `${me.name} is calling you`,
          data: JSON.stringify({ callId: call.id, from: me.id, name: me.name, type }),
        },
      })
      return json({ call: { id: call.id } })
    }
    if (action === 'end') {
      const callId = String(body.callId || '')
      const status = String(body.status || 'ended')
      const duration = body.duration == null ? null : Number(body.duration)
      if (!callId || !['ended', 'failed', 'declined', 'cancelled', 'busy'].includes(status)) return errorJson('Invalid call update', 400)
      if (duration !== null && (!Number.isFinite(duration) || duration < 0 || duration > 24 * 60 * 60)) return errorJson('Invalid call duration', 400)
      const call = await db.call.findUnique({ where: { id: callId } })
      if (!call) return errorJson('Call not found', 404)
      if (call.callerId !== me.id && call.receiverId !== me.id) return errorJson('Forbidden', 403)
      await db.call.update({
        where: { id: callId },
        data: { status, endedAt: new Date(), duration: duration ?? undefined },
      })
      return json({ ok: true })
    }
    return errorJson('Unknown action', 400)
  } catch (error) {
    return handleRouteError(error, '/api/calls')
  }
}
