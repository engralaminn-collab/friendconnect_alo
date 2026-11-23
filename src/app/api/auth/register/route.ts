import { NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { z } from "zod"
import { db } from "@/lib/db"

const RegisterSchema = z.object({
  name: z.string().min(2).max(60),
  username: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_]+$/, "Only letters, numbers, underscore"),
  email: z.string().email(),
  password: z.string().min(6).max(72),
})

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const parsed = RegisterSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 }
      )
    }
    const { name, username, email, password } = parsed.data
    const emailLc = email.toLowerCase()
    const usernameLc = username.toLowerCase()

    // Protect Jara system identity
    if (usernameLc === 'jara' || emailLc === 'jara@friendconnect.local' || emailLc.startsWith('jara@')) {
      return NextResponse.json({ error: "Username reserved — cannot impersonate system identity" }, { status: 403 })
    }

    const exists = await db.user.findFirst({
      where: { OR: [{ email: emailLc }, { username: usernameLc }] },
      select: { id: true },
    })
    if (exists) {
      return NextResponse.json({ error: "Email or username already taken" }, { status: 409 })
    }

    const passwordHash = await bcrypt.hash(password, 10)
    const user = await db.user.create({
      data: { name, username: usernameLc, email: emailLc, passwordHash },
      select: { id: true, username: true, email: true, name: true },
    })

    return NextResponse.json({ ok: true, user }, { status: 201 })
  } catch (e: any) {
    console.error("[register] error", e)
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}
