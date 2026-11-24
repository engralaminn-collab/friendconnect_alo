import { NextRequest } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { errorJson, json } from '@/lib/serialize'
import { db } from '@/lib/db'

export async function GET(req: NextRequest) {
  const me = await getSessionUser()
  if (!me) return errorJson('Unauthorized', 401)

  const room = String(req.nextUrl.searchParams.get('room') || '').trim()
  if (!room) return errorJson('room required', 400)
  // This legacy token route is restricted to FriendConnect conversation rooms;
  // authenticated users must not mint tokens for arbitrary LiveKit rooms.
  const conversationId = room.startsWith('fc-') ? room.slice(3) : ''
  if (!conversationId || conversationId.length > 191) return errorJson('Invalid room', 400)
  const membership = await db.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId: me.id } },
  }).catch(() => null)
  if (!membership) return errorJson('Not a conversation member', 403)

  const wsUrl = process.env.LIVEKIT_URL || process.env.NEXT_PUBLIC_LIVEKIT_URL
  const apiKey = process.env.LIVEKIT_API_KEY
  const apiSecret = process.env.LIVEKIT_API_SECRET
  if (!wsUrl || !apiKey || !apiSecret) {
    return errorJson('LiveKit not configured. Set LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET.', 503)
  }

  try {
    const { AccessToken } = await import('livekit-server-sdk')
    const at = new AccessToken(apiKey, apiSecret, { identity: me.id, name: me.name || me.username || me.id })
    at.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true, canPublishData: true })
    const token = await at.toJwt()
    return json({ token, url: wsUrl, room, identity: me.id })
  } catch (e: any) {
    return errorJson(`LiveKit token generation failed: ${e?.message || 'unknown error'}`, 500)
  }
}