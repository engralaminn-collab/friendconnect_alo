import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { errorJson, json } from '@/lib/serialize'
import { filterMessagesVisibleToUser } from '@/lib/ai-input'
import { handleRouteError } from '@/lib/api-errors'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const me = await getSessionUser()
    if (!me) return errorJson('Unauthorized', 401)
    const { id } = await params
    const before = req.nextUrl.searchParams.get('before')
    const membership = await db.groupMember.findUnique({
      where: { groupId_userId: { groupId: id, userId: me.id } },
    })
    if (!membership) return errorJson('Not a member', 403)
    // Finding 7: `scheduledFor` is the delivery time, and `runJobs()` only emits
    // a scheduled message once it is due. This query ignored both `expiresAt`
    // and `scheduledFor`, so a message scheduled for next week appeared in the
    // group immediately — and a disappearing message stayed readable after
    // expiry. `/api/messages` already filtered expiry; both filters now match.
    const now = new Date()
    const messages = await db.message.findMany({
      where: {
        groupId: id,
        // hide disappearing messages that have expired
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        ...(before ? { createdAt: { lt: new Date(before) } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { sender: { include: { profile: true } } },
    })
    const visible = filterMessagesVisibleToUser<any>(messages, me.id)
      // Not-yet-due scheduled messages belong to the sender's "scheduled" list
      // only; the recipient must not see them before delivery.
      .filter((m) => !m.scheduledFor || new Date(m.scheduledFor) <= now)
      .reverse()
    return json({
      messages: visible.map((m) => ({
        id: m.id,
        senderId: m.senderId,
        senderName: m.sender.name,
        senderPhoto: m.sender.profile?.photoUrl ?? null,
        content: m.content,
        type: m.type,
        fileUrl: m.fileUrl,
        fileName: m.fileName,
        fileSize: m.fileSize,
        mimeType: m.mimeType,
        createdAt: m.createdAt.toISOString(),
      })),
    })
  } catch (error) {
    return handleRouteError(error, '/api/groups/[id]/messages')
  }
}
