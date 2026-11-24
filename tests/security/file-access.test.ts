import test from 'node:test'
import assert from 'node:assert/strict'
import { canDownloadFile, grantFileAccess, grantMessageFileAccess, grantStoryFileAccess } from '../../src/lib/file-access'

/**
 * These tests describe the grant-based model introduced for finding #10.
 *
 * The previous implementation decided access by scanning `Message` rows for a
 * matching `fileUrl` on every download. That is replaced by an indexed
 * `FileAccess(fileUrl, userId)` lookup, and the grants are written when the file
 * becomes reachable. The test double below therefore records grants in memory
 * and implements exactly the queries `file-access.ts` issues.
 */
function mockStore(seed: Record<string, any[]> = {}) {
  const tables: Record<string, any[]> = {
    fileAccess: seed.fileAccess ?? [],
    profile: seed.profile ?? [],
    block: seed.block ?? [],
    friendship: seed.friendship ?? [],
    groupMember: seed.groupMember ?? [],
    message: seed.message ?? [],
    file: seed.file ?? [],
    jaraAsset: seed.jaraAsset ?? [],
  }
  let counter = 0

  const store: any = {
    __tables: tables,
    fileAccess: {
      async findFirst({ where }: any = {}) {
        return (
          tables.fileAccess.find(
            (row) =>
              (where?.fileUrl === undefined || row.fileUrl === where.fileUrl) &&
              (where?.userId === undefined || row.userId === where.userId),
          ) ?? null
        )
      },
      async create({ data }: any) {
        const row = { id: `grant-${(counter += 1)}`, expiresAt: null, messageId: null, ...data }
        tables.fileAccess.push(row)
        return row
      },
      async update({ where, data }: any) {
        const row = tables.fileAccess.find((entry) => entry.id === where.id)
        Object.assign(row ?? {}, data)
        return row
      },
      async deleteMany({ where }: any) {
        // Mutate in place: rebinding `tables.fileAccess` here would detach the
        // array the test seeded, and later reads would see stale rows.
        const keep = tables.fileAccess.filter(
          (row) =>
            !(
              (where?.fileUrl === undefined || row.fileUrl === where.fileUrl) &&
              (where?.userId === undefined || row.userId === where.userId)
            ),
        )
        tables.fileAccess.length = 0
        tables.fileAccess.push(...keep)
        return { count: 1 }
      },
    },
    profile: {
      async findFirst({ where }: any = {}) {
        return tables.profile.find((row) => where?.photoUrl === undefined || row.photoUrl === where.photoUrl) ?? null
      },
    },
    block: {
      // Honour the OR pair: a block row only applies to its own two users.
      async findFirst({ where }: any = {}) {
        const pairs: Array<{ fromId: string; toId: string }> = where?.OR ?? []
        if (!pairs.length) return tables.block[0] ?? null
        return (
          tables.block.find((row) =>
            pairs.some((pair) => pair.fromId === row.fromId && pair.toId === row.toId),
          ) ?? null
        )
      },
    },
    friendship: {
      async findFirst({ where }: any = {}) {
        const pairs: Array<{ requesterId: string; receiverId: string }> = where?.OR ?? []
        const candidates = tables.friendship.filter(
          (row) => where?.status === undefined || row.status === where.status,
        )
        if (!pairs.length) return candidates[0] ?? null
        return (
          candidates.find((row) =>
            pairs.some((pair) => pair.requesterId === row.requesterId && pair.receiverId === row.receiverId),
          ) ?? null
        )
      },
      async findMany({ where }: any = {}) {
        return tables.friendship.filter(
          (row) =>
            (where?.status === undefined || row.status === where.status) &&
            (where?.storiesMuted === undefined || row.storiesMuted === where.storiesMuted),
        )
      },
    },
    groupMember: {
      async findMany({ where }: any = {}) {
        return tables.groupMember.filter((row) => where?.groupId === undefined || row.groupId === where.groupId)
      },
    },
    message: {
      async findMany({ where }: any = {}) {
        return tables.message.filter((row) => where?.fileUrl === undefined || row.fileUrl === where.fileUrl)
      },
    },
    file: {
      async findMany() {
        return tables.file
      },
    },
    jaraAsset: {
      async findFirst() {
        return tables.jaraAsset[0] ?? null
      },
    },
  }
  return store
}

const file = { ownerId: 'owner', url: '/api/files/private-id' }

test('file owner can download their private object', async () => {
  assert.equal(await canDownloadFile('owner', file, mockStore()), true)
})

test('unrelated authenticated user cannot download a private file by its id', async () => {
  assert.equal(await canDownloadFile('stranger', file, mockStore()), false)
})

test('downloads are decided by an indexed grant, not by scanning messages', async () => {
  const store = mockStore({ fileAccess: [{ fileUrl: file.url, userId: 'friend', source: 'message_recipient' }] })
  let messageScans = 0
  const original = store.message.findMany
  store.message.findMany = async (...args: any[]) => {
    messageScans += 1
    return original.apply(store.message, args)
  }
  assert.equal(await canDownloadFile('friend', file, store), true)
  assert.equal(messageScans, 0, 'a granted download must not touch the Message table')
})

test('expired grants are not honoured', async () => {
  const expired = mockStore({
    fileAccess: [{ fileUrl: file.url, userId: 'friend', source: 'message_recipient', expiresAt: new Date(Date.now() - 1000) }],
  })
  assert.equal(await canDownloadFile('friend', file, expired), false)

  const valid = mockStore({
    fileAccess: [{ fileUrl: file.url, userId: 'friend', source: 'message_recipient', expiresAt: new Date(Date.now() + 60_000) }],
  })
  assert.equal(await canDownloadFile('friend', file, valid), true)
})

test('direct-message recipient and every group member are granted access on send', async () => {
  const direct = mockStore()
  await grantMessageFileAccess(
    { id: 'm1', fileUrl: file.url, senderId: 'owner', receiverId: 'friend', groupId: null },
    direct,
  )
  assert.equal(await canDownloadFile('friend', file, direct), true)
  assert.equal(await canDownloadFile('stranger', file, direct), false)

  const group = mockStore({
    groupMember: [
      { groupId: 'g1', userId: 'member-a' },
      { groupId: 'g1', userId: 'member-b' },
    ],
  })
  await grantMessageFileAccess(
    { id: 'm2', fileUrl: file.url, senderId: 'owner', receiverId: null, groupId: 'g1' },
    group,
  )
  assert.equal(await canDownloadFile('member-a', file, group), true)
  assert.equal(await canDownloadFile('member-b', file, group), true)
  assert.equal(await canDownloadFile('outsider', file, group), false)
})

test('story media is shared with accepted, unblocked, unmuted friends only', async () => {
  const store = mockStore({
    friendship: [
      { requesterId: 'story-owner', receiverId: 'friend', status: 'ACCEPTED', storiesMuted: false },
      { requesterId: 'story-owner', receiverId: 'muted-friend', status: 'ACCEPTED', storiesMuted: true },
      { requesterId: 'blocked-friend', receiverId: 'story-owner', status: 'ACCEPTED', storiesMuted: false },
    ],
    block: [{ id: 'block', fromId: 'blocked-friend', toId: 'story-owner' }],
  })

  await grantStoryFileAccess(
    { userId: 'story-owner', content: file.url, expiresAt: new Date(Date.now() + 60_000) },
    store,
  )

  assert.equal(await canDownloadFile('friend', file, store), true, 'an accepted friend can view story media')
  assert.equal(await canDownloadFile('muted-friend', file, store), false, 'a muted friend cannot')
  assert.equal(await canDownloadFile('stranger', file, store), false, 'a non-friend cannot')
  // The blocked friend is never granted, even though the friendship row exists.
  assert.equal(await canDownloadFile('blocked-friend', file, store), false, 'a blocked friend cannot')
})

test('a friend-only profile photo is private to accepted friends', async () => {
  const photoUrl = '/api/files/profile-photo'
  const friendProfile = { photoUrl, userId: 'profile-owner', profileVisibility: 'FRIENDS' }

  const stranger = mockStore({ profile: [friendProfile] })
  assert.equal(await canDownloadFile('stranger', { ownerId: 'profile-owner', url: photoUrl }, stranger), false)

  const friend = mockStore({
    profile: [friendProfile],
    friendship: [
      { id: 'friendship', status: 'ACCEPTED', requesterId: 'profile-owner', receiverId: 'friend' },
    ],
  })
  assert.equal(await canDownloadFile('friend', { ownerId: 'profile-owner', url: photoUrl }, friend), true)

  const blocked = mockStore({
    profile: [friendProfile],
    friendship: [
      { id: 'friendship', status: 'ACCEPTED', requesterId: 'profile-owner', receiverId: 'friend' },
    ],
    block: [{ id: 'b', fromId: 'profile-owner', toId: 'friend' }],
  })
  assert.equal(await canDownloadFile('friend', { ownerId: 'profile-owner', url: photoUrl }, blocked), false)

  const privateProfile = mockStore({
    profile: [{ ...friendProfile, profileVisibility: 'PRIVATE' }],
    friendship: [
      { id: 'f', status: 'ACCEPTED', requesterId: 'profile-owner', receiverId: 'friend' },
    ],
  })
  assert.equal(await canDownloadFile('friend', { ownerId: 'profile-owner', url: photoUrl }, privateProfile), false)
})

test('a public profile photo is downloadable and the decision is cached as a grant', async () => {
  const photoUrl = '/api/files/public-photo'
  const store = mockStore({
    profile: [{ photoUrl, userId: 'profile-owner', profileVisibility: 'PUBLIC' }],
  })
  assert.equal(await canDownloadFile('anyone', { ownerId: 'profile-owner', url: photoUrl }, store), true)
  assert.equal(
    store.__tables.fileAccess.some((row: any) => row.fileUrl === photoUrl && row.userId === 'anyone'),
    true,
    'the public decision is persisted so the next request is a single lookup',
  )
})

test('grants are idempotent', async () => {
  const store = mockStore()
  await grantFileAccess(file.url, 'friend', 'message_recipient', {}, store)
  await grantFileAccess(file.url, 'friend', 'message_recipient', {}, store)
  assert.equal(store.__tables.fileAccess.length, 1)
})
