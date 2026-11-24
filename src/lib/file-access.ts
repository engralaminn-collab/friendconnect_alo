import { db } from '@/lib/db'

/**
 * Decide whether `userId` may download a stored file.
 *
 * Finding #10: authorization used to be decided by scanning up to 100
 * `Message` rows for the same `fileUrl` and checking each one's participants,
 * then repeating the scan for profiles, avatars, stories and Jara assets. That
 * was an unindexed full-table filter on the hottest table, it silently gave up
 * after 100 matches (a file shared in a busy thread could become unreachable),
 * and it had to be re-derived on every request.
 *
 * Downloads are now decided by an indexed `FileAccess(fileUrl, userId)` lookup.
 * Grants are written when a file becomes reachable — at upload time and when a
 * message/story/profile is created — and rows are removed when sharing stops.
 * `backfillFileAccess()` plus migration v2 cover data written before this model
 * existed.
 */

export type FileAccessSource =
  | 'owner'
  | 'message_sender'
  | 'message_recipient'
  | 'group_member'
  | 'story_viewer'
  | 'profile_public'
  | 'jara_asset'

export interface StoredFile {
  ownerId: string
  url: string
}

type Store = typeof db

/** Grant access, ignoring the unique-constraint race on (fileUrl, userId). */
export async function grantFileAccess(
  fileUrl: string,
  userId: string,
  source: FileAccessSource,
  options: { messageId?: string | null; expiresAt?: Date | null } = {},
  store: Store = db,
): Promise<void> {
  if (!fileUrl || !userId) return
  try {
    const existing = await store.fileAccess.findFirst({ where: { fileUrl, userId } })
    if (existing) {
      // Refresh the reason/expiry rather than duplicating the grant.
      await store.fileAccess.update({
        where: { id: existing.id },
        data: {
          source,
          messageId: options.messageId ?? existing.messageId ?? null,
          expiresAt: options.expiresAt ?? existing.expiresAt ?? null,
        },
      })
      return
    }
    await store.fileAccess.create({
      data: {
        fileUrl,
        userId,
        source,
        messageId: options.messageId ?? null,
        expiresAt: options.expiresAt ?? null,
      },
    })
  } catch (error) {
    // A grant is derived state; a lost race is recovered by the next write or by
    // backfill. Never fail the upload/message because of it.
    console.warn('[files] could not record access grant', (error as Error).message)
  }
}

/** Remove a grant. Used when a message is deleted or sharing is withdrawn. */
export async function revokeFileAccess(
  fileUrl: string,
  userId: string,
  store: Store = db,
): Promise<void> {
  try {
    await store.fileAccess.deleteMany({ where: { fileUrl, userId } })
  } catch {
    /* best effort */
  }
}

/**
 * Grant access for every participant of a message that carries an attachment.
 * Called from the message-send paths (REST and socket).
 */
export async function grantMessageFileAccess(
  message: { id: string; fileUrl?: string | null; senderId: string; receiverId?: string | null; groupId?: string | null },
  store: Store = db,
): Promise<void> {
  if (!message.fileUrl) return
  await grantFileAccess(message.fileUrl, message.senderId, 'message_sender', { messageId: message.id }, store)
  if (message.receiverId) {
    await grantFileAccess(message.fileUrl, message.receiverId, 'message_recipient', { messageId: message.id }, store)
  }
  if (message.groupId) {
    const members = await store.groupMember.findMany({ where: { groupId: message.groupId }, select: { userId: true } })
    for (const member of members) {
      await grantFileAccess(message.fileUrl, member.userId, 'group_member', { messageId: message.id }, store)
    }
  }
}

/** Grant access to current members of a group (used when a file is attached). */
export async function grantGroupFileAccess(fileUrl: string, groupId: string, store: Store = db): Promise<void> {
  const members = await store.groupMember.findMany({ where: { groupId }, select: { userId: true } })
  for (const member of members) {
    await grantFileAccess(fileUrl, member.userId, 'group_member', {}, store)
  }
}

/** True when the profile behind `url` is public to `userId`. */
async function profileIsPublicTo(url: string, userId: string, store: Store): Promise<boolean> {
  const profile = await store.profile.findFirst({ where: { photoUrl: url } })
  if (!profile) return false
  if (profile.userId === userId) return true

  const blocked = await store.block.findFirst({
    where: { OR: [{ fromId: userId, toId: profile.userId }, { fromId: profile.userId, toId: userId }] },
    select: { id: true },
  })
  if (blocked) return false

  const visibility = profile.profileVisibility || 'PUBLIC'
  if (visibility === 'PUBLIC') return true
  if (visibility !== 'FRIENDS') return false

  const friendship = await store.friendship.findFirst({
    where: {
      status: 'ACCEPTED',
      OR: [
        { requesterId: userId, receiverId: profile.userId },
        { requesterId: profile.userId, receiverId: userId },
      ],
    },
    select: { id: true },
  })
  return Boolean(friendship)
}

/**
 * Allow downloading `file`.
 *
 * Resolution order, cheapest first:
 *   1. the caller owns the file                         (one indexed read)
 *   2. an explicit, unexpired grant exists              (one indexed read)
 *   3. the URL is a public profile photo / avatar       (public media only)
 *   4. the URL belongs to an approved Jara asset        (public media only)
 *
 * Steps 3 and 4 do not consult message contents, so adding them cannot widen
 * access to private chat attachments.
 */
export async function canDownloadFile(
  userId: string,
  file: StoredFile,
  store: Store = db,
): Promise<boolean> {
  if (!userId || !file?.url) return false

  // 1. owner
  if (file.ownerId === userId) return true

  // 2. explicit grant
  const grant = await store.fileAccess.findFirst({
    where: { fileUrl: file.url, userId },
  })
  if (grant) {
    if (!grant.expiresAt) return true
    const expiry = grant.expiresAt instanceof Date ? grant.expiresAt : new Date(grant.expiresAt)
    if (expiry.getTime() > Date.now()) return true
  }

  // 3. public profile media
  if (await profileIsPublicTo(file.url, userId, store)) {
    // Persist the decision so the next request never repeats the work.
    await grantFileAccess(file.url, userId, 'profile_public', {}, store)
    return true
  }

  // 4. approved Jara reference media (the assistant's public assets)
  const jaraAssetModel = (store as unknown as { jaraAsset?: { findFirst?: (args: unknown) => Promise<unknown> } })
    .jaraAsset
  if (jaraAssetModel?.findFirst) {
    try {
      const approved = (await jaraAssetModel.findFirst({
        where: { fileUrl: file.url, isApproved: true },
      })) as { id?: string } | null
      if (approved) {
        await grantFileAccess(file.url, userId, 'jara_asset', {}, store)
        return true
      }
    } catch {
      // Optional model on older runtimes: absence is simply "no grant".
    }
  }

  return false
}
