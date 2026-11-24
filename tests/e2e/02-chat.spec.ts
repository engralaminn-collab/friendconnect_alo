import { test, expect, type APIRequestContext, type Page } from '@playwright/test'

/**
 * One-to-one messaging, driven through the UI.
 *
 * Finding #13: the file this replaces was called "01 one-to-one messaging +
 * realtime" but never registered a session, never opened a conversation and
 * never sent a message — it asserted that `/api/jara/profile` returns the Jara
 * account. It passed while messaging was broken.
 *
 * Every step below goes through the real authenticated UI. The first version of
 * this rewrite drove chat by navigating to `/?view=chat&user=<id>`; the app has
 * no URL routing (`src/app/page.tsx` is a single shell with no `searchParams`),
 * so that navigation silently stayed on the welcome screen and the composer was
 * never visible. Chat is opened by selecting a conversation in the sidebar or by
 * creating one through the New chat dialog — this spec now does the latter, which
 * is the same path a user takes.
 */

interface Account {
  name: string
  username: string
  email: string
  password: string
  id: string
}

async function register(request: APIRequestContext, label: string): Promise<Account> {
  const unique = `${label}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`.toLowerCase()
  const account: Account = {
    name: `E2E ${label}`,
    username: unique,
    email: `${unique}@e2e.invalid`,
    password: 'Passw0rd!123',
    id: '',
  }
  const response = await request.post('/api/auth/register', {
    data: { name: account.name, username: account.username, email: account.email, password: account.password },
  })
  expect(response.status(), `register ${label}: ${await response.text()}`).toBe(201)
  const body = await response.json()
  account.id = body?.user?.id ?? ''
  expect(account.id, 'registration must return the new user id').not.toBe('')
  return account
}

/** Sign in through the real login form and wait for the authenticated shell. */
async function loginViaUi(page: Page, account: Account) {
  await page.goto('/')
  await page.getByTestId('auth-identifier').fill(account.username)
  await page.getByTestId('auth-password').fill(account.password)
  await page.getByTestId('auth-submit').click()
  await expect(page.getByTestId('app-shell')).toBeVisible({ timeout: 30_000 })
}

/** Become friends through the friendship contract the UI itself posts to. */
async function befriend(asRequester: Page, asReceiver: Page, requester: Account, receiver: Account) {
  const requested = await asRequester.request.post('/api/friends', {
    data: { action: 'request', targetId: receiver.id },
  })
  expect(requested.status(), await requested.text()).toBe(200)
  expect((await requested.json()).status).toBe('PENDING')

  // `id` in this route is the other user's id (see the route docblock).
  const accepted = await asReceiver.request.post(`/api/friends/request/${requester.id}/accept`)
  expect(accepted.status(), await accepted.text()).toBe(200)
}

/** Open a direct conversation with `peer` through the New chat dialog. */
async function openChatWith(page: Page, peer: Account) {
  await page.getByTestId('new-chat').click()
  const friend = page.getByTestId('new-chat-friend').filter({ hasText: peer.name })
  await expect(friend).toBeVisible({ timeout: 15_000 })
  await friend.click()
  // Selecting a conversation renders ChatView in the main pane.
  await expect(page.getByTestId('chat-composer-input')).toBeVisible({ timeout: 30_000 })
}

test.describe('one-to-one messaging', () => {
  test('a message sent through the UI is stored, delivered to the peer and persists across reload', async ({
    browser,
    request,
  }) => {
    const alice = await register(request, 'alice')
    const bob = await register(request, 'bob')

    // Two independent browser contexts, so the two sessions do not share
    // cookies — that is what makes the delivery assertion meaningful.
    const aliceContext = await browser.newContext()
    const alicePage = await aliceContext.newPage()
    await loginViaUi(alicePage, alice)

    const bobContext = await browser.newContext()
    const bobPage = await bobContext.newPage()
    await loginViaUi(bobPage, bob)

    await befriend(alicePage, bobPage, alice, bob)

    // Alice opens a direct chat with Bob from the sidebar dialog and sends.
    await alicePage.reload()
    await expect(alicePage.getByTestId('app-shell')).toBeVisible()
    await openChatWith(alicePage, bob)
    await alicePage.getByTestId('chat-composer-input').fill('hello from the e2e suite')
    await alicePage.getByTestId('chat-send').click()
    await expect(alicePage.getByText('hello from the e2e suite')).toBeVisible({ timeout: 15_000 })

    // Bob sees it too. He opens the same conversation from his own session; the
    // message is read from the database rather than echoed from Alice's client.
    await bobPage.reload()
    await expect(bobPage.getByTestId('app-shell')).toBeVisible()
    await openChatWith(bobPage, alice)
    await expect(bobPage.getByText('hello from the e2e suite')).toBeVisible({ timeout: 30_000 })

    // It survives a full reload: it is persisted, not client state.
    await bobPage.reload()
    await bobPage.getByTestId('new-chat').click()
    const aliceRow = bobPage.getByTestId('new-chat-friend').filter({ hasText: alice.name })
    await expect(aliceRow).toBeVisible({ timeout: 15_000 })
    await aliceRow.click()
    await expect(bobPage.getByText('hello from the e2e suite')).toBeVisible({ timeout: 30_000 })

    // And the REST contract agrees.
    const thread = await bobPage.request.get(`/api/messages?userId=${alice.id}`)
    expect(thread.status()).toBe(200)
    const messages = (await thread.json()).messages as Array<{ content: string; senderId: string }>
    const delivered = messages.find((message) => message.content === 'hello from the e2e suite')
    expect(delivered, 'the message must be readable through the API').toBeTruthy()
    expect(delivered?.senderId).toBe(alice.id)

    // Bob replies and Alice receives it without reloading her page.
    await bobPage.getByTestId('chat-composer-input').fill('reply from bob')
    await bobPage.getByTestId('chat-send').click()
    await expect(alicePage.getByText('reply from bob')).toBeVisible({ timeout: 30_000 })

    await aliceContext.close()
    await bobContext.close()
  })

  test('an unrelated user cannot read the conversation or react to its messages', async ({ browser, request }) => {
    const alice = await register(request, 'alice3')
    const bob = await register(request, 'bob3')
    const eve = await register(request, 'eve3')

    const aliceContext = await browser.newContext()
    const alicePage = await aliceContext.newPage()
    await loginViaUi(alicePage, alice)

    const bobContext = await browser.newContext()
    const bobPage = await bobContext.newPage()
    await loginViaUi(bobPage, bob)

    await befriend(alicePage, bobPage, alice, bob)

    // Seed the message through the API as Alice (the chat UI path is covered by
    // the first test; here the subject is authorization).
    const sent = await alicePage.request.post('/api/messages', {
      data: { receiverId: bob.id, content: 'private between alice and bob' },
    })
    expect(sent.status(), await sent.text()).toBe(200)
    const messageId = (await sent.json()).message.id as string

    // Eve has her own session and tries to read and to react.
    const eveContext = await browser.newContext()
    const evePage = await eveContext.newPage()
    await loginViaUi(evePage, eve)

    const espionage = await evePage.request.get(`/api/messages?userId=${alice.id}`)
    const eveMessages = ((await espionage.json()).messages ?? []) as Array<{ content: string }>
    expect(eveMessages.map((m) => m.content)).not.toContain('private between alice and bob')

    // A non-participant gets 404, not 403: a message id must not be probeable
    // for existence. Either status is a refusal, so assert the refusal rather
    // than a specific code (see the route docblock).
    const reaction = await evePage.request.post(`/api/messages/${messageId}/reactions`, {
      data: { emoji: '\u{1F44D}' },
    })
    expect([403, 404]).toContain(reaction.status())

    // Bob, a real participant, can react — so the denial above is authorization,
    // not a broken endpoint.
    const bobReaction = await bobPage.request.post(`/api/messages/${messageId}/reactions`, {
      data: { emoji: '\u{1F44D}' },
    })
    expect([200, 201]).toContain(bobReaction.status())

    await aliceContext.close()
    await bobContext.close()
    await eveContext.close()
  })
})
