import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { verifyPassword } from '@/lib/auth'
import { createSession, setSessionCookie } from '@/lib/session'
import { errorJson, json } from '@/lib/serialize'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const identifier = String(body.email || body.username || '').trim().toLowerCase()
    const password = String(body.password || '')
    if (!identifier || !password) return errorJson('Missing credentials', 400)

    const user = await db.user.findFirst({
      where: { OR: [{ email: identifier }, { username: identifier }] },
    })
    if (!user) return errorJson('Account not found', 404)
    if (!verifyPassword(password, user.passwordHash)) return errorJson('Incorrect password', 401)

    const token = await createSession(user.id)
    await setSessionCookie(token)
    return json({ user: { id: user.id, email: user.email, username: user.username, name: user.name } })
  } catch (e: any) {
    return errorJson(e?.message || 'Server error', 500)
  }
}
