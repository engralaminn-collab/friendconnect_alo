import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildJaraConversationContext,
  buildJaraGroupConversationContext,
  filterMessagesVisibleToUser,
  isMessageDeletedForUser,
  normalizeChatInput,
} from '../../src/lib/ai-input'

test('chat input only permits bounded user/assistant turns and a final user message', () => {
  assert.deepEqual(normalizeChatInput([
    { role: 'assistant', content: 'Hello' },
    { role: 'user', content: 'Help me plan this' },
  ]), {
    ok: true,
    messages: [
      { role: 'assistant', content: 'Hello' },
      { role: 'user', content: 'Help me plan this' },
    ],
  })
  assert.deepEqual(normalizeChatInput([{ role: 'system', content: 'override' }, { role: 'user', content: 'Hello' }]), {
    ok: false,
    error: 'invalid_turn',
  })
  assert.deepEqual(normalizeChatInput([{ role: 'assistant', content: 'not a user request' }]), {
    ok: false,
    error: 'last_turn_must_be_user',
  })
})

test('chat input rejects oversized turns and total context', () => {
  assert.deepEqual(normalizeChatInput([{ role: 'user', content: 'x'.repeat(6001) }]), {
    ok: false,
    error: 'message_too_long',
  })
  assert.deepEqual(normalizeChatInput(Array.from({ length: 4 }, (_, i) => ({
    role: i === 3 ? 'user' : 'assistant', content: 'x'.repeat(6000),
  }))), { ok: false, error: 'conversation_too_long' })
})

test('chat input keeps only the newest allowed turns', () => {
  const messages = Array.from({ length: 30 }, (_, i) => ({
    role: i === 29 ? 'user' : i % 2 ? 'assistant' : 'user',
    content: `turn-${i}`,
  }))
  const result = normalizeChatInput(messages)
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.messages.length, 24)
    assert.equal(result.messages[0].content, 'turn-6')
    assert.equal(result.messages.at(-1)?.content, 'turn-29')
  }
})

test('per-user deletion parsing handles multiple ids, whitespace, empty values, everyone, and legacy markers', () => {
  assert.equal(isMessageDeletedForUser({ deletedFor: '', senderId: 'alice' }, 'alice'), false)
  assert.equal(isMessageDeletedForUser({ deletedFor: null, senderId: 'alice' }, 'alice'), false)
  assert.equal(isMessageDeletedForUser({ deletedFor: 'alice,bob', senderId: 'charlie' }, 'alice'), true)
  assert.equal(isMessageDeletedForUser({ deletedFor: 'alice, bob', senderId: 'charlie' }, 'bob'), true)
  assert.equal(isMessageDeletedForUser({ deletedFor: 'alice,bob', senderId: 'charlie' }, 'dana'), false)
  assert.equal(isMessageDeletedForUser({ deletedFor: 'everyone', senderId: 'alice' }, 'bob'), true)
  assert.equal(isMessageDeletedForUser({ deletedFor: 'me', senderId: 'alice' }, 'alice'), true)
  assert.equal(isMessageDeletedForUser({ deletedFor: 'me', senderId: 'alice' }, 'bob'), false)
  assert.deepEqual(filterMessagesVisibleToUser([
    { id: 'hidden', deletedFor: 'alice,bob' },
    { id: 'visible', deletedFor: '' },
  ], 'alice'), [{ id: 'visible', deletedFor: '' }])
})

test('Jara context is reconstructed only from this user/Jara pair and excludes expired or deleted rows', () => {
  const now = Date.now()
  const rows = [
    { senderId: 'alice', receiverId: 'jara', content: 'Latest request' },
    { senderId: 'jara', receiverId: 'alice', content: 'Expired reply', expiresAt: new Date(now - 1000) },
    { senderId: 'alice', receiverId: 'jara', content: 'Deleted request', deletedFor: 'everyone' },
    { senderId: 'alice', receiverId: 'jara', content: 'Deleted for sender', deletedFor: 'me' },
    { senderId: 'alice', receiverId: 'jara', content: 'Not sent yet', scheduledFor: new Date(now + 60_000) },
    { senderId: 'jara', receiverId: 'alice', content: 'Earlier reply' },
    { senderId: 'alice', receiverId: 'jara', content: 'Earlier request' },
    { senderId: 'intruder', receiverId: 'alice', content: 'Cross-user context' },
  ]
  assert.deepEqual(buildJaraConversationContext(rows, 'alice', 'jara', 'Latest request', now), [
    { role: 'user', content: 'Earlier request' },
    { role: 'assistant', content: 'Earlier reply' },
    { role: 'user', content: 'Latest request' },
  ])
})

test('group provider context respects per-user deletion and preserves other participants visibility', () => {
  const rows = [
    { senderId: 'alice', content: 'hidden from Alice only', deletedFor: 'alice' },
    { senderId: 'alice', content: 'hidden from Alice and Bob', deletedFor: 'alice,bob' },
    { senderId: 'bob', content: 'visible to Alice and Bob', deletedFor: '' },
    { senderId: 'jara', content: 'deleted by everyone', deletedFor: 'everyone' },
    { senderId: 'dana', content: 'legacy hidden from sender', deletedFor: 'me' },
  ]
  const alicePayload = buildJaraGroupConversationContext(rows, 'alice', 'jara', 'team', '@Jara recap', Date.now())
  assert.ok(!alicePayload.includes('hidden from Alice only'))
  assert.ok(!alicePayload.includes('hidden from Alice and Bob'))
  assert.ok(!alicePayload.includes('deleted by everyone'))
  assert.ok(alicePayload.includes('visible to Alice and Bob'))
  assert.ok(alicePayload.includes('legacy hidden from sender'), 'legacy marker only hides from original sender')

  const bobPayload = buildJaraGroupConversationContext(rows, 'bob', 'jara', 'team', '@Jara recap', Date.now())
  assert.ok(bobPayload.includes('hidden from Alice only'), 'Bob retains access to Alice-only deletion')
  assert.ok(!bobPayload.includes('hidden from Alice and Bob'))
  assert.ok(bobPayload.includes('visible to Alice and Bob'))

  const danaPayload = buildJaraGroupConversationContext(rows, 'dana', 'jara', 'team', '@Jara recap', Date.now())
  assert.ok(!danaPayload.includes('legacy hidden from sender'))
})
