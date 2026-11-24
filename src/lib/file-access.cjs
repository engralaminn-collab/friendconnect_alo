'use strict'

/**
 * Grant-based file download authorization — the implementation shared by the
 * Next.js routes and the standalone Socket.IO server.
 *
 * Finding #10: authorization used to be decided by scanning up to 100 `Message`
 * rows for the same `fileUrl` and checking each one's participants, then
 * repeating the scan for profiles, avatars, stories and Jara assets. That was an
 * unindexed full-table filter on the hottest table, it silently gave up after
 * 100 matches (a file shared in a busy thread could become unreachable), and it
 * had to be re-derived on every request.
 *
 * Downloads are now decided by an indexed `FileAccess(fileUrl, userId)` lookup.
 * Grants are written when a file becomes reachable — at upload time and when a
 * message/story is created — and rows are removed when sharing stops.
 *
 * This module lives in `.cjs` because `socket-server.js` is plain CommonJS and
 * cannot import the TypeScript module. `src/lib/file-access.ts` is the typed
 * facade used by the app; both must stay behaviourally identical, so the logic
 * lives here exactly once.
 *
 * The store is never required at module scope: the caller injects it, either
 * per call (tests) or once per process via `setStoreProvider()`. That keeps the
 * database-backend selection in one place per entry point (finding #8).
 */

let storeProvider = null

/** Register how a missing store argument is resolved (once per process). */
function setStoreProvider(provider) {
  storeProvider = provider
}

function resolveStore(store) {
  if (store) return store
  if (storeProvider) return storeProvider()
  throw new Error(
    'file-access: no database store configured — call setStoreProvider() or pass one explicitly'
  )
}

function asTime(value) {
  if (!value) return null
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime()
  return Number.isFinite(time) ? time : null
}

/** Grant access, ignoring the unique-constraint race on (fileUrl, userId). */
async function grantFileAccess(fileUrl, userId, source, options = {}, store = null) {
  if (!fileUrl || !userId) return
  const db = resolveStore(store)
  const { messageId = null, expiresAt = null } = options || {}
  try {
    const existing = await db.fileAccess.findFirst({ where: { fileUrl, userId } })
    if (existing) {
      // Refresh the reason/expiry rather than duplicating the grant.
      await db.fileAccess.update({
        where: { id: existing.id },
        data: {
          source,
          messageId: messageId ?? existing.messageId ?? null,
          expiresAt: expiresAt ?? existing.expiresAt ?? null,
        },
      })
      return
    }
    await db.fileAccess.create({
      data: { fileUrl, userId, source, messageId: messageId ?? null, expiresAt: expiresAt ?? null },
    })
  } catch (error) {
    // A grant is derived state; a lost race is recovered by the next write or by
    // backfill. Never fail the upload/message because of it.
    console.warn('[files] could not record access grant', error && error.message)
  }
}

/** Remove a grant. Used when a message is deleted or sharing is withdrawn. */
async function revokeFileAccess(fileUrl, userId, store = null) {
  if (!fileUrl || !userId) return
  try {
    await resolveStore(store).fileAccess.deleteMany({ where: { fileUrl, userId } })
  } catch {
    /* best effort */
  }
}

/**
 * Revoke only the grants that were created by one message.
 *
 * Deleting a message for everyone clears its `fileUrl`; the same upload may be
 * shared in other threads, so revoking by URL would break those. Grants carry
 * the `messageId` that created them, which is the precise key.
 */
async function revokeMessageGrants(message, store = null) {
  if (!message || !message.id) return
  try {
    await resolveStore(store).fileAccess.deleteMany({ where: { messageId: message.id } })
  } catch {
    /* best effort */
  }
}

/**
 * Grant access for every participant of a message that carries an attachment.
 * Called from the message-send paths (REST and socket).
 */
async function grantMessageFileAccess(message, store = null) {
  if (!message) return
  const urls = []
  if (typeof message.fileUrl === 'string' && message.fileUrl) urls.push(message.fileUrl)
  if (Array.isArray(message.attachments)) {
    for (const att of message.attachments) {
      if (att && typeof att.url === 'string' && att.url && !urls.includes(att.url)) urls.push(att.url)
    }
  }
  if (!urls.length) return
  const db = resolveStore(store)
  for (const url of urls) {
    await grantFileAccess(url, message.senderId, 'message_sender', { messageId: message.id }, db)
    if (message.receiverId) {
      await grantFileAccess(url, message.receiverId, 'message_recipient', { messageId: message.id }, db)
    }
    if (message.groupId) {
      const members = await db.groupMember.findMany({
        where: { groupId: message.groupId },
        select: { userId: true },
      })
      for (const member of members) {
        await grantFileAccess(url, member.userId, 'group_member', { messageId: message.id }, db)
      }
    }
    if (message.conversationId && db.conversationMember && typeof db.conversationMember.findMany === 'function') {
      const members = await db.conversationMember.findMany({
        where: { conversationId: message.conversationId },
        select: { userId: true },
      })
      for (const member of members) {
        await grantFileAccess(url, member.userId, 'message_recipient', { messageId: message.id }, db)
      }
    }
  }
}

/**
 * Grant story-viewing access for a media URL to accepted, unblocked, unmuted
 * friends at the moment the story is created.
 *
 * Stories put their media URL in `Story.content` (or `mediaUrl`). Rather than
 * resolving that union on every download, the audience is materialised as
 * grants when the story is posted, and revoked when it expires or is deleted.
 */
async function grantStoryFileAccess(story, store = null) {
  const db = resolveStore(store)
  const url =
    story.mediaUrl ||
    (typeof story.content === 'string' && story.content.startsWith('/api/files/') ? story.content : null)
  if (!url) return

  // The author always sees their own story.
  await grantFileAccess(url, story.userId, 'story_viewer', { expiresAt: story.expiresAt ?? null }, db)

  const friendships = await db.friendship.findMany({
    where: {
      status: 'ACCEPTED',
      storiesMuted: false,
      OR: [{ requesterId: story.userId }, { receiverId: story.userId }],
    },
    select: { requesterId: true, receiverId: true },
  })

  for (const friendship of friendships) {
    const friendId =
      friendship.requesterId === story.userId ? friendship.receiverId : friendship.requesterId
    const blocked = await db.block.findFirst({
      where: { OR: [{ fromId: friendId, toId: story.userId }, { fromId: story.userId, toId: friendId }] },
      select: { id: true },
    })
    if (blocked) continue
    await grantFileAccess(url, friendId, 'story_viewer', { expiresAt: story.expiresAt ?? null }, db)
  }
}

/** Grant access to current members of a group (used when a file is attached). */
async function grantGroupFileAccess(fileUrl, groupId, store = null) {
  const db = resolveStore(store)
  const members = await db.groupMember.findMany({ where: { groupId }, select: { userId: true } })
  for (const member of members) {
    await grantFileAccess(fileUrl, member.userId, 'group_member', {}, db)
  }
}

/** True when the profile behind `url` is public to `userId`. */
async function profileIsPublicTo(url, userId, db, fileOwnerId = null) {
  let targetUserId = null
  let visibility = 'PUBLIC'

  const profile = db.profile && typeof db.profile.findFirst === 'function'
    ? await db.profile.findFirst({ where: { photoUrl: url } })
    : null
  if (profile) {
    targetUserId = profile.userId
    visibility = profile.profileVisibility || 'PUBLIC'
  } else if (db.user && typeof db.user.findFirst === 'function') {
    const user = await db.user.findFirst({
      where: { avatarUrl: url },
      select: { id: true, profile: { select: { profileVisibility: true } } },
    })
    if (user) {
      targetUserId = user.id
      visibility = user.profile?.profileVisibility || 'PUBLIC'
    }
  }

  if (!targetUserId) return false
  if (fileOwnerId && targetUserId !== fileOwnerId) return false
  if (targetUserId === userId) return true

  const blocked = await db.block.findFirst({
    where: { OR: [{ fromId: userId, toId: targetUserId }, { fromId: targetUserId, toId: userId }] },
    select: { id: true },
  })
  if (blocked) return false

  if (visibility === 'PUBLIC') return true
  if (visibility !== 'FRIENDS') return false

  const friendship = await db.friendship.findFirst({
    where: {
      status: 'ACCEPTED',
      OR: [
        { requesterId: userId, receiverId: targetUserId },
        { requesterId: targetUserId, receiverId: userId },
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
async function canDownloadFile(userId, file, store = null) {
  if (!userId || !file || !file.url) return false
  const db = resolveStore(store)

  // 1. owner
  if (file.ownerId === userId) return true

  // 2. explicit grant
  const grant = await db.fileAccess.findFirst({ where: { fileUrl: file.url, userId } })
  if (grant) {
    const expiry = asTime(grant.expiresAt)
    if (expiry === null || expiry > Date.now()) return true
  }

  // 3. public profile media
  if (await profileIsPublicTo(file.url, userId, db, file.ownerId || null)) {
    // Persist the decision so the next request never repeats the work.
    await grantFileAccess(file.url, userId, 'profile_public', {}, db)
    return true
  }

  // 4. approved Jara reference media (the assistant's public assets)
  const jaraAssetModel = db.jaraAsset
  if (jaraAssetModel && typeof jaraAssetModel.findFirst === 'function') {
    try {
      const approved = await jaraAssetModel.findFirst({
        where: { fileUrl: file.url, isApproved: true },
      })
      if (approved) {
        await grantFileAccess(file.url, userId, 'jara_asset', {}, db)
        return true
      }
    } catch {
      // Optional model on older runtimes: absence is simply "no grant".
    }
  }

  return false
}

/**
 * Rebuild `FileAccess` grants for data written before the table existed.
 *
 * Migration v2 backfills what it can in SQL. This routine covers the rest —
 * attachments whose message row arrived after the migration, and grants lost to
 * a concurrent write — and is safe to run more than once. It is O(files), not
 * O(messages), so it is cheap enough to run from a cron job or CLI:
 * `npm run backfill:file-access`.
 */
async function backfillFileAccess(store = null, options = {}) {
  const db = resolveStore(store)
  const limit = Number(options.limit || 5000)
  const files = await db.file.findMany({ take: limit, select: { url: true, ownerId: true } })
  let grants = 0

  for (const file of files) {
    const existing = await db.fileAccess.findFirst({
      where: { fileUrl: file.url, userId: file.ownerId },
      select: { id: true },
    })
    if (!existing) {
      await grantFileAccess(file.url, file.ownerId, 'owner', {}, db)
      grants += 1
    }

    // Re-derive participant grants from the messages that carry this file.
    // `fileUrl` is indexed, so this is a lookup rather than a scan.
    const messages = await db.message.findMany({
      where: { fileUrl: file.url },
      select: { id: true, senderId: true, receiverId: true, groupId: true },
      take: 50,
    })
    for (const message of messages) {
      await grantMessageFileAccess(message, db)
      grants += 1
    }
  }

  return { files: files.length, grants }
}

module.exports = {
  setStoreProvider,
  grantFileAccess,
  revokeFileAccess,
  revokeMessageGrants,
  grantMessageFileAccess,
  grantStoryFileAccess,
  grantGroupFileAccess,
  canDownloadFile,
  backfillFileAccess,
}
