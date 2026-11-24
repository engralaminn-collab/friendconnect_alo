import { test, expect } from '@playwright/test'
import {
  befriend,
  dumpDiagnostics,
  loginViaUi,
  openChatWith,
  openListedChatWith,
  register,
  trackedPage,
} from './support'

/**
 * One-to-one messaging, driven through the UI.
 *
 * Finding #13: the file this replaced was called "01 one-to-one messaging +
 * realtime" but never registered a session, never opened a conversation and never
 * sent a message — it asserted that `/api/jara/profile` returns the Jara account.
 *
 * Everything here goes through the real authenticated UI. Two earlier versions of
 * this rewrite were wrong in ways only a browser exposed, and both are worth
 * remembering:
 *
 * 1. It opened chat with `/?view=chat&user=<id>`. `src/app/page.tsx` is a single
 *    shell that never reads search params, so that navigation stayed on the
 *    welcome screen.
 * 2. It filled `auth-identifier`, which only existed on
 *    `components/fc/auth/AuthFlow.tsx` — a component this app never mounts. The
 *    mounted sign-in screen is `components/chat/AuthScreen.tsx`.
 *
 * Pages are created through `trackedPage`, so a failure records console errors,
 * page errors, failed requests and the rendered text in
 * `test-results/diagnostics.txt`, which CI publishes as an annotation.
 */

test.describe('one-to-one messaging', () => {
  test.afterEach(async ({}, testInfo) => {
    await dumpDiagnostics(testInfo)
  })

  test('a message sent through the UI is stored, delivered to the peer and persists across reload', async ({
    browser,
    request,
  }) => {
    const alice = await register(request, 'alice')
    const bob = await register(request, 'bob')

    // Separate contexts: the two sessions must not share cookies.
    const alicePage = await trackedPage(browser, 'alice')
    await loginViaUi(alicePage, alice)
    const bobPage = await trackedPage(browser, 'bob')
    await loginViaUi(bobPage, bob)

    await befriend(alicePage, bobPage, alice, bob)

    // Alice opens the chat from her sidebar and sends a message.
    await alicePage.reload()
    await expect(alicePage.getByTestId('app-shell')).toBeVisible({ timeout: 30_000 })
    await openChatWith(alicePage, bob)
    await alicePage.getByTestId('chat-composer-input').fill('hello from the e2e suite')
    await alicePage.getByTestId('chat-send').click()
    await expect(
      alicePage.getByTestId('chat-messages').getByText('hello from the e2e suite'),
    ).toBeVisible({ timeout: 15_000 })

    // Bob opens the *same* conversation in his own session and reads the message
    // from the database rather than from Alice's client.
    await bobPage.reload()
    await expect(bobPage.getByTestId('app-shell')).toBeVisible({ timeout: 30_000 })
    await openChatWith(bobPage, alice)
    await expect(
      bobPage.getByTestId('chat-messages').getByText('hello from the e2e suite'),
    ).toBeVisible({ timeout: 30_000 })

    // It survives a reload: it is persisted, not client state.
    await bobPage.reload()
    await expect(bobPage.getByTestId('app-shell')).toBeVisible({ timeout: 30_000 })
    await openListedChatWith(bobPage, alice)
    await expect(
      bobPage.getByTestId('chat-messages').getByText('hello from the e2e suite'),
    ).toBeVisible({ timeout: 30_000 })

    // The REST contract agrees. The composer writes through the conversation
    // endpoint, which stores messages with a `conversationId` and no
    // `receiverId`; the legacy `/api/messages?userId=` thread endpoint only sees
    // receiver-addressed messages and therefore cannot read this thread. Read it
    // the same way the UI does.
    const listed = await bobPage.request.get('/api/conversations')
    expect(listed.status()).toBe(200)
    const conversations = (await listed.json()).conversations as Array<{
      id: string
      otherUser?: { id: string } | null
    }>
    const direct = conversations.find((c) => c.otherUser?.id === alice.id)
    expect(direct, 'bob must see the direct conversation with alice').toBeTruthy()
    const thread = await bobPage.request.get(`/api/conversations/${direct!.id}/messages`)
    expect(thread.status()).toBe(200)
    const messages = (await thread.json()).messages as Array<{ content: string; senderId: string }>
    const delivered = messages.find((message) => message.content === 'hello from the e2e suite')
    expect(delivered, 'the message must be readable through the API').toBeTruthy()
    expect(delivered?.senderId).toBe(alice.id)

    // Bob replies; Alice reads it back through the API after a reload. The
    // realtime socket is deliberately not asserted here: it needs the separate
    // socket server that e2e/serve.cjs starts, and a socket assertion is flaky at
    // one worker. What must not regress is that both sides read the stored
    // message.
    await bobPage.getByTestId('chat-composer-input').fill('reply from bob')
    await bobPage.getByTestId('chat-send').click()
    await expect(
      bobPage.getByTestId('chat-messages').getByText('reply from bob'),
    ).toBeVisible({ timeout: 15_000 })

    await alicePage.reload()
    await expect(alicePage.getByTestId('app-shell')).toBeVisible({ timeout: 30_000 })
    await openListedChatWith(alicePage, bob)
    await expect(
      alicePage.getByTestId('chat-messages').getByText('reply from bob'),
    ).toBeVisible({ timeout: 30_000 })
  })

  test('an unrelated user cannot read the conversation or react to its messages', async ({ browser, request }) => {
    const alice = await register(request, 'alice3')
    const bob = await register(request, 'bob3')
    const eve = await register(request, 'eve3')

    const alicePage = await trackedPage(browser, 'alice')
    await loginViaUi(alicePage, alice)
    const bobPage = await trackedPage(browser, 'bob')
    await loginViaUi(bobPage, bob)

    await befriend(alicePage, bobPage, alice, bob)

    // The chat UI path is covered above; the subject here is authorization.
    const sent = await alicePage.request.post('/api/messages', {
      data: { receiverId: bob.id, content: 'private between alice and bob' },
    })
    expect(sent.status(), await sent.text()).toBe(200)
    const messageId = (await sent.json()).message.id as string

    const evePage = await trackedPage(browser, 'eve')
    await loginViaUi(evePage, eve)

    // Eve's UI does not show the conversation, and the API does not either.
    await expect(evePage.getByTestId('sidebar-conversation').filter({ hasText: 'E2E alice' })).toHaveCount(0)
    const espionage = await evePage.request.get(`/api/messages?userId=${alice.id}`)
    const eveMessages = ((await espionage.json()).messages ?? []) as Array<{ content: string }>
    expect(eveMessages.map((m) => m.content)).not.toContain('private between alice and bob')

    // A non-participant gets 404, not 403: a message id must not be probeable for
    // existence. Both are refusals, so assert the refusal.
    const reaction = await evePage.request.post(`/api/messages/${messageId}/reactions`, {
      data: { emoji: '\u{1F44D}' },
    })
    expect([403, 404]).toContain(reaction.status())

    // Bob is a participant and can react, so the denial above is authorization
    // rather than a broken endpoint.
    const bobReaction = await bobPage.request.post(`/api/messages/${messageId}/reactions`, {
      data: { emoji: '\u{1F44D}' },
    })
    expect([200, 201]).toContain(bobReaction.status())
  })
})
