import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { hashPassword } from '@/lib/auth'
import { ensureProfile, json, errorJson } from '@/lib/serialize'
import { getSessionUser } from '@/lib/session'
import { handleRouteError } from '@/lib/api-errors'

const DEMO = [
  { name: 'Aria Ahmed', username: 'aria', email: 'aria@friendconnect.app', password: 'password123', bio: 'Reconnecting with old classmates.', location: 'Dhaka, Bangladesh' },
  { name: 'Bilal Khan', username: 'bilal', email: 'bilal@friendconnect.app', password: 'password123', bio: 'Traveler. Coffee enthusiast.', location: 'Chittagong, Bangladesh' },
  { name: 'Carla Gomez', username: 'carla', email: 'carla@friendconnect.app', password: 'password123', bio: 'Designer & music lover.', location: 'Madrid, Spain' },
]

export async function POST(req: NextRequest) {
  try {
    const allow = process.env.ALLOW_SETUP === 'true' || process.env.NODE_ENV !== 'production'
    if (!allow) {
      const me = await getSessionUser()
      if (!me || me.role !== 'admin') return errorJson('Setup is disabled in production', 403)
    }
    const secret = process.env.SETUP_SECRET
    if (secret) {
      const provided = req.headers.get('x-setup-secret') || ''
      if (provided !== secret) return errorJson('Forbidden', 403)
    }

    const created: { username: string; email: string; password: string; name: string }[] = []
    const ids: Record<string, string> = {}
    for (const d of DEMO) {
      let user = await db.user.findUnique({ where: { email: d.email } })
      if (!user) {
        user = await db.user.create({
          data: { email: d.email, username: d.username, name: d.name, passwordHash: await hashPassword(d.password), emailVerified: true },
        })
      }
      await ensureProfile(user.id)
      await db.profile.update({
        where: { userId: user.id },
        data: { bio: d.bio, location: d.location },
      })
      if (d.username === 'aria') {
        await db.user.update({ where: { id: user.id }, data: { role: 'admin', emailVerified: true } })
        await db.profile.updateMany({ where: { userId: user.id }, data: { verified: 'verified' } })
      }
      ids[d.username] = user.id
      created.push({ username: d.username, email: d.email, password: d.password, name: d.name })
    }
    const link = async (a: string, b: string) => {
      const aId = ids[a]
      const bId = ids[b]
      const existing = await db.friendship.findFirst({
        where: { OR: [{ requesterId: aId, receiverId: bId }, { requesterId: bId, receiverId: aId }] },
      })
      if (!existing) {
        await db.friendship.create({ data: { requesterId: aId, receiverId: bId, status: 'ACCEPTED' } })
      }
    }
    await link('aria', 'bilal')
    await link('aria', 'carla')

    const existingMsg = await db.message.findFirst({ where: { senderId: ids['aria'], receiverId: ids['bilal'] } })
    if (!existingMsg) {
      await db.message.create({ data: { senderId: ids['aria'], receiverId: ids['bilal'], content: 'Hey Bilal! Long time no see 🎉', type: 'text', status: 'SEEN' } })
      await db.message.create({ data: { senderId: ids['bilal'], receiverId: ids['aria'], content: 'Aria! So good to hear from you. How have you been?', type: 'text', status: 'SEEN' } })
    }

    return json({ ok: true, accounts: created })
  } catch (error) {
    return handleRouteError(error, '/api/setup')
  }
}
