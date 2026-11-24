import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { errorJson, json } from '@/lib/serialize'
import { handleRouteError } from '@/lib/api-errors'

// POST /api/messages/[id]/delete  { scope: 'me' | 'everyone' }
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const me = await getSessionUser()
    if (!me) return errorJson('Unauthorized', 401)
    const { id } = await params
    const body = await req.json()
    const scope = body.scope === 'everyone' ? 'everyone' : 'me'
    const msg = await db.message.findUnique({
      where: { id },
      select: { id: true, senderId: true, receiverId: true, groupId: true, conversationId: true, deletedFor: true },
    })
    if (!msg) return errorJson('Message not found', 404)

    // Only a participant may change their own visibility state.
    let isParticipant = msg.senderId === me.id || msg.receiverId === me.id
    if (msg.groupId) {
      isParticipant = !!await db.groupMember.findUnique({ where: { groupId_userId: { groupId: msg.groupId, userId: me.id } } })
    } else if (msg.conversationId) {
      isParticipant = !!await db.conversationMember.findUnique({ where: { conversationId_userId: { conversationId: msg.conversationId, userId: me.id } } })
    }
    if (!isParticipant) return errorJson('Forbidden', 403)

    if (scope === 'everyone') {
      // only sender can delete for everyone
      if (msg.senderId !== me.id) return errorJson('Only sender can delete for everyone', 403)
      await db.message.update({
        where: { id },
        data: { deletedFor: 'everyone', content: '', fileUrl: null, fileName: null, fileSize: null, mimeType: null },
      })
    } else {
      // Preserve delete-for-everyone and normalize the legacy sender-only marker
      // before adding another participant to the per-user visibility list.
      const raw = typeof msg.deletedFor === 'string' ? msg.deletedFor.trim() : ''
      if (raw !== 'everyone') {
        const existing = raw === 'me'
          ? [msg.senderId]
          : raw.split(',').map((value) => value.trim()).filter(Boolean)
        if (!existing.includes(me.id)) existing.push(me.id)
        await db.message.update({ where: { id }, data: { deletedFor: existing.join(',') } })
      }
    }
    return json({ ok: true, scope })
  } catch (error) {
    return handleRouteError(error, '/api/messages/[id]/delete')
  }
}
