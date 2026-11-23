import { NextRequest } from 'next/server'
import { errorJson, json } from '@/lib/serialize'
import { db } from '@/lib/db'
import { JARA_ID } from '@/lib/jara'

// GET /api/jara/profile — Jara's public profile (anyone can view)
export async function GET() {
  try {
    let user = await (db as any).user.findUnique({
      where: { id: JARA_ID },
      include: { profile: true },
    }).catch(() => null)

    // If not exists, return synthetic profile (DB may not have seeded yet)
    if (!user) {
      return json({
        user: {
          id: JARA_ID,
          username: 'jara',
          name: 'Jara',
          email: 'jara@friendconnect.local',
          avatarUrl: null,
          bio: 'I am Jara — your friendly AI assistant. 🤖 I can chat in English, Bangla, and Banglish!',
          status: 'AI Assistant • Online',
          role: 'jara',
          isJara: true,
          isAI: true,
          lastSeenAt: new Date().toISOString(),
        },
        profile: {
          verified: 'verified',
          photoUrl: null,
          bio: 'AI Assistant — I am Jara, here to help you!',
        },
      })
    }

    return json({
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        email: user.email,
        avatarUrl: user.avatarUrl,
        bio: user.bio,
        status: user.status,
        role: user.role,
        isJara: true,
        isAI: true,
        lastSeenAt: user.lastSeenAt,
      },
      profile: user.profile,
    })
  } catch (e: any) {
    return errorJson(e?.message || 'Server error', 500)
  }
}
