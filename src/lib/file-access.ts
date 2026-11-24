import { db } from '@/lib/db'

/** A stored file is private unless its owner has explicitly shared it. */
export async function canDownloadFile(userId: string, file: { ownerId: string; url: string }, store: typeof db = db): Promise<boolean> {
  if (file.ownerId === userId) return true

  // Files attached to a direct message are visible only to its two participants.
  const messages = await store.message.findMany({
    where: {
      fileUrl: file.url,
      deletedFor: { not: 'everyone' },
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    take: 100,
  })
  for (const message of messages) {
    if (message.senderId === userId || message.receiverId === userId) return true
    if (message.groupId) {
      const membership = await store.groupMember.findUnique({
        where: { groupId_userId: { groupId: message.groupId, userId } },
        select: { id: true },
      })
      if (membership) return true
    }
  }

  // Profile photos are public only when the profile is public; FRIENDS profiles
  // continue to work for accepted friends without making private files public.
  const profile = await store.profile.findFirst({ where: { photoUrl: file.url } })
  if (profile) {
    if (profile.userId === userId) return true
    const blocked = await store.block.findFirst({
      where: { OR: [{ fromId: userId, toId: profile.userId }, { fromId: profile.userId, toId: userId }] },
      select: { id: true },
    })
    if (blocked) return false
    if (profile.profileVisibility === 'PUBLIC') return true
    if (profile.profileVisibility === 'FRIENDS') {
      const friendship = await store.friendship.findFirst({
        where: {
          status: 'ACCEPTED',
          OR: [
            { requesterId: userId, receiverId: profile.userId },
            { requesterId: profile.userId, receiverId: userId },
          ],
        },
      })
      if (friendship) return true
    }
  }
  const avatarOwners = await store.user.findMany({ where: { avatarUrl: file.url }, take: 100 })
  for (const avatarOwner of avatarOwners) {
    if (avatarOwner.id === userId) return true
    const blocked = await store.block.findFirst({
      where: { OR: [{ fromId: userId, toId: avatarOwner.id }, { fromId: avatarOwner.id, toId: userId }] },
      select: { id: true },
    })
    if (blocked) continue
    const ownerProfile = await store.profile.findFirst({ where: { userId: avatarOwner.id } })
    if (ownerProfile?.profileVisibility === 'PUBLIC') return true
    if (ownerProfile?.profileVisibility === 'FRIENDS') {
      const friendship = await store.friendship.findFirst({
        where: {
          status: 'ACCEPTED',
          OR: [
            { requesterId: userId, receiverId: avatarOwner.id },
            { requesterId: avatarOwner.id, receiverId: userId },
          ],
        },
      })
      if (friendship) return true
    }
  }

  // Approved Jara reference media is presented to authenticated users by the
  // existing Jara UI. Older SQLite runtimes may not expose this optional model.
  const jaraAssetModel = (store as any).jaraAsset
  if (jaraAssetModel?.findFirst) {
    const approvedAsset = await jaraAssetModel.findFirst({ where: { fileUrl: file.url, isApproved: true } }).catch(() => null)
    if (approvedAsset) return true
  }

  // Stories are shared with accepted friends by the existing stories API.
  const stories = await store.story.findMany({
    where: { userId: { not: userId }, content: file.url, OR: [{ expiresAt: { gt: new Date() } }, { isHighlight: true }] },
    take: 100,
  })
  for (const story of stories) {
    const [friendship, blocked] = await Promise.all([
      store.friendship.findFirst({
        where: {
          status: 'ACCEPTED',
          OR: [
            { requesterId: userId, receiverId: story.userId },
            { requesterId: story.userId, receiverId: userId },
          ],
        },
      }),
      store.block.findFirst({
        where: { OR: [{ fromId: userId, toId: story.userId }, { fromId: story.userId, toId: userId }] },
        select: { id: true },
      }),
    ])
    if (friendship && !friendship.storiesMuted && !blocked) return true
  }
  return false
}
