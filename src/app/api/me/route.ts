import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/session"
import { db } from "@/lib/db"
import { z } from "zod"

function isSafeAvatarUrl(val: string | null | undefined): boolean {
  if (val === null || val === undefined || val === "") return true
  if (val.startsWith("/api/files/")) return /^\/api\/files\/[a-f0-9]{24,48}$/i.test(val)
  try {
    const u = new URL(val)
    return u.protocol === "https:" || u.protocol === "http:"
  } catch {
    return false
  }
}

const ProfileSchema = z.object({
  name: z.string().min(2).max(60).optional(),
  bio: z.string().max(200).optional(),
  status: z.string().max(120).optional(),
  avatarUrl: z
    .string()
    .max(500)
    .refine((v) => isSafeAvatarUrl(v), "Invalid avatar URL")
    .nullable()
    .optional(),
})

export async function GET() {
  const u = await getCurrentUser()
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  // Never return server-side auth secrets to the client. The TOTP seed in
  // particular would let anyone who reads this response clone the authenticator.
  const { twoFactorSecret: _secret, ...safe } = u
  return NextResponse.json({
    user: { ...safe, hasTwoFactorSecret: !!_secret },
  })
}

export async function PATCH(req: Request) {
  const u = await getCurrentUser()
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const parsed = ProfileSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid" }, { status: 400 })
  }

  const nextData = { ...parsed.data }
  if (typeof nextData.avatarUrl === "string" && nextData.avatarUrl.startsWith("/api/files/")) {
    const ownedFile = await db.file.findFirst({
      where: { url: nextData.avatarUrl, ownerId: u.id },
      select: { id: true },
    })
    if (!ownedFile) {
      return NextResponse.json({ error: "Avatar file not found or not owned by user" }, { status: 403 })
    }
  }

  const updated = await db.user.update({
    where: { id: u.id },
    data: nextData,
    select: { id: true, name: true, bio: true, status: true, avatarUrl: true, username: true, email: true },
  })

  if (nextData.avatarUrl !== undefined) {
    await db.profile
      .upsert({
        where: { userId: u.id },
        update: { photoUrl: nextData.avatarUrl || null },
        create: { userId: u.id, photoUrl: nextData.avatarUrl || null },
      })
      .catch(() => {})
  }

  return NextResponse.json({ user: updated })
}
