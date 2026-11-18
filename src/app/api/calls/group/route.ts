import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/session"
import { errorJson, json } from "@/lib/serialize"
import { db } from "@/lib/db"
import { AccessToken, RoomServiceClient } from "livekit-server-sdk"

export async function POST(req: NextRequest) {
  const me = await getSessionUser()
  if (!me) return errorJson("Unauthorized", 401)

  const { conversationId, action } = await req.json()

  if (action === "start" || action === "join") {
    if (!conversationId) return errorJson("conversationId required", 400)

    // Verify membership
    const membership = await db.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId, userId: me.id } },
    })
    if (!membership) return errorJson("Not a member", 403)

    const livekitUrl = process.env.LIVEKIT_URL || process.env.NEXT_PUBLIC_LIVEKIT_URL
    const livekitApiKey = process.env.LIVEKIT_API_KEY
    const livekitApiSecret = process.env.LIVEKIT_API_SECRET

    if (!livekitUrl || !livekitApiKey || !livekitApiSecret) {
      return errorJson("LiveKit not configured — set LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET", 503)
    }

    // Room name = conversation ID (stable per conversation)
    const roomName = `fc-${conversationId}`
    const participantName = me.username || me.name || me.id

    // Create the room if it doesn't exist
    try {
      const roomService = new RoomServiceClient(livekitUrl, livekitApiKey, livekitApiSecret)
      await roomService.createRoom({ name: roomName, emptyTimeout: 10 * 60 })
    } catch (e: any) {
      // Room might already exist — that's fine
    }

    // Generate access token
    const token = new AccessToken(livekitApiKey, livekitApiSecret, {
      identity: me.id,
      name: participantName,
      ttl: 60 * 60, // 1 hour
    })
    token.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true, canPublishData: true })

    const jwt = await token.toJwt()

    // Record the call
    if (action === "start") {
      await db.call.create({
        data: {
          callerId: me.id,
          calleeId: me.id, // group call — caller is also callee
          type: "video",
          status: "started",
          startedAt: new Date(),
        },
      }).catch(() => {})
    }

    return json({
      token: jwt,
      url: livekitUrl,
      roomName,
      identity: me.id,
    })
  }

  if (action === "end") {
    if (!conversationId) return errorJson("conversationId required", 400)
    const livekitUrl = process.env.LIVEKIT_URL
    const livekitApiKey = process.env.LIVEKIT_API_KEY
    const livekitApiSecret = process.env.LIVEKIT_API_SECRET
    if (!livekitUrl || !livekitApiKey || !livekitApiSecret) {
      return errorJson("LiveKit not configured", 503)
    }
    try {
      const roomService = new RoomServiceClient(livekitUrl, livekitApiKey, livekitApiSecret)
      await roomService.deleteRoom(`fc-${conversationId}`)
    } catch (e: any) {
      // Room might already be gone
    }
    return json({ ok: true })
  }

  return errorJson("Invalid action — use 'start', 'join', or 'end'", 400)
}
