import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { errorJson, json } from '@/lib/serialize'
import { handleRouteError } from '@/lib/api-errors'

export async function GET() {
  try {
    const sessionUser = await getSessionUser()
    if (!sessionUser) return json({ user: null }, 200)

    // Single query with profile relation to reduce TTFB latency
    const user = await db.user.findUnique({
      where: { id: sessionUser.id },
      select: {
        id: true,
        email: true,
        username: true,
        name: true,
        role: true,
        emailVerified: true,
        twoFactorEnabled: true,
        fileQuotaBytes: true,
        fileUsedBytes: true,
        profile: true,
      },
    })

    if (!user) return json({ user: null }, 200)

    return json({
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        name: user.name,
        role: user.role || 'user',
        emailVerified: user.emailVerified ?? false,
        twoFactorEnabled: user.twoFactorEnabled ?? false,
        fileQuota: { used: user.fileUsedBytes, quota: user.fileQuotaBytes },
        profile: user.profile
          ? {
              photoUrl: user.profile.photoUrl,
              bio: user.profile.bio,
              phone: user.profile.phone,
              location: user.profile.location,
              birthday: user.profile.birthday,
              education: user.profile.education,
              work: user.profile.work,
              profileVisibility: user.profile.profileVisibility,
              messagePermission: user.profile.messagePermission,
              callPermission: user.profile.callPermission,
              readReceipts: user.profile.readReceipts,
              photoFilter: user.profile.photoFilter,
              verified: user.profile.verified,
              lastSeen: user.profile.lastSeen?.toISOString(),
            }
          : null,
      },
    })
  } catch (error) {
    return handleRouteError(error, '/api/auth/me')
  }
}
