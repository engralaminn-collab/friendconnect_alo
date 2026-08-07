import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { errorJson, json } from '@/lib/serialize'

// GET all my chat preferences (for the conversation list to show pin/mute/disappearing/wallpaper)
export async function GET() {
  try {
    const me = await getSessionUser()
    if (!me) return errorJson('Unauthorized', 401)
    const prefs = await db.chatPreference.findMany({ where: { userId: me.id } })
    return json({
      preferences: prefs.map((p) => ({
        peerId: p.peerId,
        pinned: p.pinned,
        muted: p.muted,
        disappearing: p.disappearing,
        wallpaper: p.wallpaper,
        archived: p.archived,
      })),
    })
  } catch (e: any) {
    return errorJson(e?.message || 'Server error', 500)
  }
}

// POST set preferences for a peer (pin/mute/disappearing/wallpaper)
export async function POST(req: NextRequest) {
  try {
    const me = await getSessionUser()
    if (!me) return errorJson('Unauthorized', 401)
    const body = await req.json()
    const peerId = String(body.peerId || '')
    if (!peerId) return errorJson('peerId required', 400)
    const data: { pinned?: boolean; muted?: boolean; disappearing?: string; wallpaper?: string | null; archived?: boolean } = {}
    if (typeof body.pinned === 'boolean') data.pinned = body.pinned
    if (typeof body.muted === 'boolean') data.muted = body.muted
    if (typeof body.disappearing === 'string' && ['OFF', '24H', '7D'].includes(body.disappearing)) data.disappearing = body.disappearing
    if (body.wallpaper !== undefined) data.wallpaper = body.wallpaper === '' ? null : String(body.wallpaper)
    if (typeof body.archived === 'boolean') data.archived = body.archived
    const pref = await db.chatPreference.upsert({
      where: { userId_peerId: { userId: me.id, peerId } },
      update: data,
      create: { userId: me.id, peerId, ...data },
    })
    return json({
      preference: {
        peerId,
        pinned: pref.pinned,
        muted: pref.muted,
        disappearing: pref.disappearing,
        wallpaper: pref.wallpaper,
        archived: pref.archived,
      },
    })
  } catch (e: any) {
    return errorJson(e?.message || 'Server error', 500)
  }
}
