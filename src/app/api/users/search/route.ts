import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionUser } from '@/lib/session'
import { errorJson } from '@/lib/serialize'

export async function GET(req: NextRequest) {
  try {
    const me = await getSessionUser()
    if (!me) return errorJson('Unauthorized', 401)

    const { searchParams } = new URL(req.url)
    const q = (searchParams.get('q') || '').trim()
    if (q.length < 2) return NextResponse.json({ users: [] })

    const users = await prisma.user.findMany({
      where: {
        id: { not: me.id },
        OR: [{ username: { contains: q } }, { name: { contains: q } }],
      },
      select: {
        id: true,
        username: true,
        name: true,
        profile: { select: { photoUrl: true, bio: true, verified: true } },
      },
      take: 30,
    })

    const relations = await prisma.friendship.findMany({
      where: {
        OR: [{ requesterId: me.id }, { receiverId: me.id }],
      },
    })

    const relByPeer = new Map<string, string>()
    for (const f of relations) {
      const peer = f.requesterId === me.id ? f.receiverId : f.requesterId
      if (f.status === 'BLOCKED') relByPeer.set(peer, 'BLOCKED')
      else if (f.status === 'ACCEPTED') relByPeer.set(peer, 'ACCEPTED')
      else if (f.status === 'PENDING') relByPeer.set(peer, 'PENDING')
      else relByPeer.set(peer, f.status)
    }

    const ranked = users
      .map((u) => ({
        id: u.id,
        username: u.username,
        name: u.name,
        photoUrl: u.profile?.photoUrl ?? null,
        bio: u.profile?.bio ?? null,
        verified: u.profile?.verified ?? 'unverified',
        relation: relByPeer.get(u.id) || 'NONE',
      }))
      .sort((a, b) => {
        const ae = a.username.toLowerCase() === q.toLowerCase() ? 0 : 1
        const be = b.username.toLowerCase() === q.toLowerCase() ? 0 : 1
        if (ae !== be) return ae - be
        return a.name.localeCompare(b.name)
      })

    return NextResponse.json({ users: ranked })
  } catch (error: unknown) {
    const err = error as Error
    return NextResponse.json({ users: [], error: err.message }, { status: 500 })
  }
}
