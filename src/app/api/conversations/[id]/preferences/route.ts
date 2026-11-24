import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/session"
import { db } from "@/lib/db"

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const conversationId = (await params).id
  const membership = await db.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId: me.id } },
  })
  if (!membership) return NextResponse.json({ error: "Not a member" }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const data: { pinned?: boolean; muted?: boolean } = {}
  if (typeof body.pinned === "boolean") data.pinned = body.pinned
  if (typeof body.muted === "boolean") data.muted = body.muted
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No preference fields provided" }, { status: 400 })
  }

  const updated = await db.conversationMember.update({
    where: { conversationId_userId: { conversationId, userId: me.id } },
    data,
    select: { conversationId: true, userId: true, pinned: true, muted: true },
  })
  return NextResponse.json({ preference: updated })
}

export const POST = PATCH
