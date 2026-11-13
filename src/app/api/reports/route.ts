import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/session"
import { db } from "@/lib/db"
import { z } from "zod"

const ReportSchema = z.object({
  toId: z.string(),
  reason: z.string().min(3).max(100),
  detail: z.string().max(1000).optional(),
})

export async function GET() {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const reports = await db.report.findMany({
    where: { fromId: me.id },
    include: { to: { select: { id: true, username: true, name: true } } },
    orderBy: { createdAt: "desc" },
    take: 50,
  })
  return NextResponse.json({ reports })
}

export async function POST(req: Request) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const parsed = ReportSchema.safeParse(body)
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid" }, { status: 400 })
  const { toId, reason, detail } = parsed.data
  if (toId === me.id) return NextResponse.json({ error: "Invalid target" }, { status: 400 })
  const target = await db.user.findUnique({ where: { id: toId }, select: { id: true } })
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 })
  const report = await db.report.create({ data: { fromId: me.id, toId, reason, detail } })
  return NextResponse.json({ ok: true, report }, { status: 201 })
}
