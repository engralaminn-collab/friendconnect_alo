import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/session"
import { db } from "@/lib/db"
import { z } from "zod"

const ProfileSchema = z.object({
  name: z.string().min(2).max(60).optional(),
  bio: z.string().max(200).optional(),
  status: z.string().max(120).optional(),
  avatarUrl: z.string().max(500).nullable().optional(),
})

export async function GET() {
  const u = await getCurrentUser()
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  return NextResponse.json({ user: u })
}

export async function PATCH(req: Request) {
  const u = await getCurrentUser()
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const parsed = ProfileSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid" }, { status: 400 })
  }
  const updated = await db.user.update({
    where: { id: u.id },
    data: parsed.data,
    select: { id: true, name: true, bio: true, status: true, avatarUrl: true, username: true, email: true },
  })
  return NextResponse.json({ user: updated })
}
