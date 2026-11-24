import test from 'node:test'
import assert from 'node:assert/strict'
import { canDownloadFile } from '../../src/lib/file-access'

function mockStore(overrides: Record<string, any> = {}) {
  return {
    message: { findMany: async () => [], ...overrides.message },
    groupMember: { findUnique: async () => null, ...overrides.groupMember },
    profile: { findFirst: async () => null, ...overrides.profile },
    user: { findMany: async () => [], ...overrides.user },
    story: { findMany: async () => [], ...overrides.story },
    friendship: { findFirst: async () => null, ...overrides.friendship },
    block: { findFirst: async () => null, ...overrides.block },
  } as any
}

const file = { ownerId: 'owner', url: '/api/files/private-id' }

test('file owner can download their private object', async () => {
  assert.equal(await canDownloadFile('owner', file, mockStore()), true)
})

test('unrelated authenticated user cannot download a private file by its id', async () => {
  assert.equal(await canDownloadFile('stranger', file, mockStore()), false)
})

test('direct-message participant and group member can access a shared attachment', async () => {
  const directStore = mockStore({ message: { findMany: async () => [{ senderId: 'owner', receiverId: 'friend', groupId: null }] } })
  assert.equal(await canDownloadFile('friend', file, directStore), true)
  const groupStore = mockStore({
    message: { findMany: async () => [{ senderId: 'owner', receiverId: null, groupId: 'group-1' }] },
    groupMember: { findUnique: async () => ({ id: 'member-1' }) },
  })
  assert.equal(await canDownloadFile('member', file, groupStore), true)
})

test('unexpired stories and highlights are accessible to accepted, unblocked, unmuted friends only', async () => {
  const activeStory = { userId: 'story-owner', content: file.url, expiresAt: new Date(Date.now() + 60_000), isHighlight: false }
  const allowed = mockStore({
    story: { findMany: async () => [activeStory] },
    friendship: { findFirst: async () => ({ id: 'friendship', storiesMuted: false }) },
  })
  assert.equal(await canDownloadFile('friend', file, allowed), true)
  const muted = mockStore({
    story: { findMany: async () => [activeStory] },
    friendship: { findFirst: async () => ({ id: 'friendship', storiesMuted: true }) },
  })
  assert.equal(await canDownloadFile('friend', file, muted), false)
  const blocked = mockStore({
    story: { findMany: async () => [activeStory] },
    friendship: { findFirst: async () => ({ id: 'friendship', storiesMuted: false }) },
    block: { findFirst: async () => ({ id: 'block' }) },
  })
  assert.equal(await canDownloadFile('friend', file, blocked), false)
})

test('friend-only profile photo is private to accepted friends and denied after a block removes friendship', async () => {
  const privateStore = mockStore({ profile: { findFirst: async () => ({ userId: 'profile-owner', profileVisibility: 'PRIVATE' }) } })
  assert.equal(await canDownloadFile('stranger', file, privateStore), false)
  const friendsStore = mockStore({
    profile: { findFirst: async () => ({ userId: 'profile-owner', profileVisibility: 'FRIENDS' }) },
    friendship: { findFirst: async () => ({ id: 'friendship' }) },
  })
  assert.equal(await canDownloadFile('friend', file, friendsStore), true)
})
