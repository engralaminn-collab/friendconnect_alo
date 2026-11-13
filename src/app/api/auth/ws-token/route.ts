import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/session"
import crypto from "crypto"

// Issue a short-lived WebSocket auth token tied to the current user.
// Format: base64url(payload).base64url(hmac)
// Payload: { uid, username, exp }
export async function GET() {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const secret = process.env.NEXTAUTH_SECRET || "friendconnect-dev-secret-change-in-production"
  const exp = Date.now() + 1000 * 60 * 60 * 24 // 24h
  const payload = { uid: me.id, username: me.username, exp }
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url")
  const sig = crypto.createHmac("sha256", secret).update(payloadB64).digest("base64url")
  const token = `${payloadB64}.${sig}`
  return NextResponse.json({ token, userId: me.id, username: me.username })
}
