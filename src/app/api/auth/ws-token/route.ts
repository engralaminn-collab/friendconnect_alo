import { NextResponse } from "next/server"
import { getCurrentUser, getCurrentSessionToken } from "@/lib/session"

// Issue a short-lived WebSocket auth token tied to the current user.
// Format: base64url(payload).base64url(hmac)
// Payload: { uid, username, exp }
export async function GET() {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const token = await getCurrentSessionToken()
  if (!token) return NextResponse.json({ error: "Session is no longer active" }, { status: 401 })
  return NextResponse.json({ token, userId: me.id, username: me.username }, {
    headers: { "Cache-Control": "no-store" },
  })
}
