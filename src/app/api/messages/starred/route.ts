import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { errorJson, json } from '@/lib/serialize'
import { handleRouteError } from '@/lib/api-errors'
import { filterMessagesVisibleToUser } from '@/lib/ai-input'

// GET all messages I've starred (across all conversations)
export async function GET() {
  try {
    const me = await getSessionUser()
    if (!me) return errorJson('Unauthorized', 401)
    const stars = await db.messageStar.findMany({
      where: { userId: me.id },
      orderBy: { createdAt: 'desc' },
      include: {
        message: {
          include: {
            sender: { select: { id: true, name: true, username: true, profile: { select: { photoUrl: true } } } },
          },
        },
      },
    })
    const visible = filterMessagesVisibleToUser<any>(
      stars.filter((s) => s.message).map((s) => ({ ...s.message, starredAt: s.createdAt })),
      me.id,
    )
    return json({
      starred: visible.map((m) => ({
        id: m.id,
        conversationId: m.conversationId ?? null,
        senderId: m.senderId,
        senderName: m.sender?.name || 'User',
        senderUsername: m.sender?.username || '',
        senderPhoto: m.sender?.profile?.photoUrl ?? null,
        content: m.content,
        type: m.type,
        fileUrl: m.fileUrl,
        fileName: m.fileName,
        createdAt: m.createdAt instanceof Date ? m.createdAt.toISOString() : m.createdAt,
        starredAt: m.starredAt instanceof Date ? m.starredAt.toISOString() : m.starredAt,
        receiverId: m.receiverId,
        groupId: m.groupId,
        deletedFor: m.deletedFor,
      })),
    })
  } catch (error) {
    return handleRouteError(error, '/api/messages/starred')
  }
}
