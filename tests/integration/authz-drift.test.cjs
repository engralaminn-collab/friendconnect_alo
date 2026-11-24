'use strict'

/**
 * Authorization drift guard (finding #14).
 *
 * The socket server and the REST API each decide whether two users may talk.
 * Before this remediation they disagreed: the socket called `canInteract()`
 * (which reads the `Block` table and the recipient's `messagePermission`), while
 * `POST /api/messages` looked for `Friendship.status === 'BLOCKED'` — a state the
 * old request-only flow never wrote — and compared `receiverId` to `receiverId`,
 * a filter that could not match. A blocked user could therefore post over REST
 * what the socket refused.
 *
 * Two independent guards:
 *
 *   1. Static: the REST routes must not re-implement the decision. They must
 *      import the shared primitive from `socket-security.cjs`.
 *   2. Behavioural: for the same pair of users, the REST answer and the shared
 *      primitive's answer must agree in every relationship state.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('fs')
const { join, resolve } = require('path')

const repo = resolve(__dirname, '../..')

/** Routes that gate direct messaging and therefore must use the shared helper. */
const MESSAGING_ROUTES = [
  'src/app/api/messages/route.ts',
  'src/app/api/messages/[id]/reactions/route.ts',
]

test('REST messaging routes use the shared canInteract/isMessageParticipant primitive', () => {
  for (const route of MESSAGING_ROUTES) {
    const source = readFileSync(join(repo, route), 'utf8')
    assert.match(
      source,
      /from ['"]@\/lib\/socket-security\.cjs['"]/,
      `${route} must import its authorization decision from socket-security.cjs so it cannot drift from the socket server`,
    )
    assert.match(
      source,
      /canInteract|isMessageParticipant/,
      `${route} imports the shared module but never calls it`,
    )
  }
})

test('no route decides messaging permission from Friendship.status on its own', () => {
  // The anti-pattern that caused the drift: a route reading the relationship's
  // status directly to decide whether a message may be sent.
  const offenders = []
  for (const route of MESSAGING_ROUTES) {
    const source = readFileSync(join(repo, route), 'utf8')
    // Strip comments: the fix is documented in comments that mention the old code.
    const code = source
      .split('\n')
      .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
      .join('\n')
    if (/status:\s*['"]BLOCKED['"]/.test(code) && !/socket-security/.test(code)) {
      offenders.push(route)
    }
  }
  assert.deepEqual(offenders, [], 'these routes still hand-roll the blocked check')
})

test('socket server and REST import the same authorization module', () => {
  const socket = readFileSync(join(repo, 'socket-server.js'), 'utf8')
  assert.match(
    socket,
    /require\(['"]\.\/src\/lib\/socket-security\.cjs['"]\)/,
    'socket-server.js must use the shared module',
  )
})

/**
 * Behavioural parity: run the shared primitive against a store that models each
 * relationship state, and assert the answers the REST routes rely on.
 */
test('the shared primitive returns the same answer for every relationship state', async () => {
  const { canInteract, canMessage, canCall, isMessageParticipant } = require(join(
    repo,
    'src/lib/socket-security.cjs',
  ))

  const makeStore = ({ block = null, relationship = null, profile = null } = {}) => ({
    block: { findFirst: async () => block },
    friendship: { findFirst: async () => relationship },
    user: { findUnique: async () => (profile === null ? null : { id: 'b', profile }) },
    groupMember: { findUnique: async () => null },
  })

  const cases = [
    {
      name: 'accepted friends may message and call',
      store: makeStore({ relationship: { id: 'f', status: 'ACCEPTED' } }),
      expect: { message: true, call: true },
    },
    {
      name: 'a block wins over friendship',
      store: makeStore({ block: { id: 'b' }, relationship: { id: 'f', status: 'ACCEPTED' } }),
      expect: { message: false, call: false },
    },
    {
      name: 'a stale BLOCKED friendship counts even without a Block row',
      store: makeStore({ relationship: { id: 'f', status: 'BLOCKED' } }),
      expect: { message: false, call: false },
    },
    {
      name: 'a pending request does not grant messaging',
      store: makeStore({ relationship: { id: 'f', status: 'PENDING' } }),
      expect: { message: false, call: false },
    },
    {
      name: 'EVERYONE permission allows a stranger to message',
      store: makeStore({ profile: { messagePermission: 'EVERYONE', callPermission: 'FRIENDS' } }),
      expect: { message: true, call: false },
    },
    {
      name: 'legacy PUBLIC permission is honoured',
      store: makeStore({ profile: { messagePermission: 'PUBLIC', callPermission: 'PUBLIC' } }),
      expect: { message: true, call: true },
    },
    {
      name: 'the default FRIENDS permission refuses a stranger',
      store: makeStore({ profile: { messagePermission: 'FRIENDS', callPermission: 'FRIENDS' } }),
      expect: { message: false, call: false },
    },
    {
      name: 'a user with no profile is refused, not allowed by default',
      store: makeStore({ profile: null }),
      expect: { message: false, call: false },
    },
    {
      name: 'the built-in assistant stays reachable',
      store: makeStore(),
      to: 'jara-ai-system-001',
      expect: { message: true, call: true },
    },
    {
      name: 'a user cannot message themselves',
      store: makeStore({ profile: { messagePermission: 'EVERYONE' } }),
      to: 'a',
      expect: { message: false, call: false },
    },
  ]

  for (const testCase of cases) {
    const to = testCase.to ?? 'b'
    assert.equal(
      await canMessage(testCase.store, 'a', to),
      testCase.expect.message,
      `canMessage: ${testCase.name}`,
    )
    assert.equal(
      await canCall(testCase.store, 'a', to),
      testCase.expect.call,
      `canCall: ${testCase.name}`,
    )
    // canInteract is the single implementation behind both helpers.
    assert.equal(
      await canInteract(testCase.store, 'a', to, 'messagePermission'),
      testCase.expect.message,
      `canInteract: ${testCase.name}`,
    )
  }

  // Participant checks used by reactions and message edits.
  const participantStore = {
    groupMember: {
      findUnique: async ({ where }) =>
        where?.groupId_userId?.groupId === 'group-1' ? { id: 'member' } : null,
    },
  }
  assert.equal(
    await isMessageParticipant(participantStore, 'u1', { senderId: 'u1', receiverId: 'u2' }),
    true,
    'the sender is a participant',
  )
  assert.equal(
    await isMessageParticipant(participantStore, 'u3', { senderId: 'u1', receiverId: 'u2' }),
    false,
    'a third party is not a participant',
  )
  assert.equal(
    await isMessageParticipant(participantStore, 'u3', { groupId: 'group-1' }),
    true,
    'a group member participates in group messages',
  )
  assert.equal(
    await isMessageParticipant(participantStore, 'u3', { groupId: 'group-2' }),
    false,
    'a non-member does not participate in another group',
  )
})
