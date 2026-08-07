import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { ensureProfile, errorJson, json } from '@/lib/serialize'

export async function GET() {
  try {
    const user = await getSessionUser()
    if (!user) return json({ user: null }, 200)
    await ensureProfile(user.id)
    const profile = await db.profile.findUnique({ where: { userId: user.id } })
    return json({
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        name: user.name,
        profile: profile
          ? {
              photoUrl: profile.photoUrl,
              bio: profile.bio,
              phone: profile.phone,
              location: profile.location,
              birthday: profile.birthday,
              education: profile.education,
              work: profile.work,
              profileVisibility: profile.profileVisibility,
              messagePermission: profile.messagePermission,
              callPermission: profile.callPermission,
              readReceipts: profile.readReceipts,
              photoFilter: profile.photoFilter,
              lastSeen: profile.lastSeen?.toISOString(),
            }
          : null,
      },
    })
  } catch (e: any) {
    return errorJson(e?.message || 'Server error', 500)
  }
}
