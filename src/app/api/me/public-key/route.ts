import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/session"
import { db } from "@/lib/db"

// GET: return current user's public key
export async function GET() {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const user = await db.user.findUnique({
    where: { id: me.id },
    select: { publicKey: true },
  })
  return NextResponse.json({ publicKey: user?.publicKey || null })
}

// POST: publish/update the current user's E2EE public key
export async function POST(req: Request) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { publicKey } = await req.json()
  if (!publicKey || typeof publicKey !== "string" || publicKey.length > 500) {
    return NextResponse.json({ error: "Invalid public key" }, { status: 400 })
  }
  await db.user.update({
    where: { id: me.id },
    data: { publicKey },
  })
  return NextResponse.json({ ok: true })
}
