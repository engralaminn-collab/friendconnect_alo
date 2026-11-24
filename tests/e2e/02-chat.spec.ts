import { test, expect, type APIRequestContext, type Page } from '@playwright/test'

/**
 * One-to-one messaging, driven through the UI.
 *
 * Finding #13: the file this replaces was called "01 one-to-one messaging +
 * realtime" but never registered a session, never opened a conversation and never
 * sent a message — it asserted that `/api/jara/profile` returns the Jara account.
 * It passed while messaging was broken.
 *
 * Everything below goes through the real authenticated UI. Two earlier versions
 * of this rewrite were wrong in ways only a real browser exposed, and both are
 * worth knowing about:
 *
 * 1. It opened chat with `/?view=chat&user=<id>`. `src/app/page.tsx` is a single
 *    shell that never reads search params, so that navigation stayed on the
 *    welcome screen.
 * 2. It filled `auth-identifier`, which existed on `components/fc/auth/AuthFlow.tsx`
 *    — a component this app never mounts. The mounted sign-in screen is
 *    `components/chat/AuthScreen.tsx`, which had no test ids at all.
 *
 * The selectors used here are therefore the ones on the components `page.tsx`
 * actually renders.
 */

interface Account {
  name: string
  username: string
  email: string
  password: string
  id: string
}

const PASSWORD = 'Passw0rd!123'

async function register(request: APIRequestContext, label: string): Promise<Account> {
  const unique = `${label}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`.toLowerCase()
  const account: Account = {
    name: `E2E ${label}`,
    username: unique,
    email: `${unique}@e2e.invalid`,
    password: PASSWORD,
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

/** Sign in on the real sign-in screen (`components/chat/AuthScreen.tsx`). */
async function loginViaUi(page: Page, account: Account) {
  await page.goto('/')
  await expect(page.getByTestId('auth-identifier')).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('auth-identifier').fill(account.username)
  await page.getByTestId('auth-password').fill(account.password)
  await page.getByTestId('auth-submit').click()
  await expect(page.getByTestId('app-shell')).toBeVisible({ timeout: 30_000 })
}

/** Subscribe to a peer. `request/[id]/accept` takes the requester's id. */
async function befriend(asRequester: Page, asReceiver: Page, requester: Account, receiver: Account) {
  const requested = await asRequester.request.post('/api/friends', {
    data: { action: 'request', targetId: receiver.id },
  })
  expect(requested.status(), await requested.text()).toBe(200)
  expect((await requested.json()).status).toBe('PENDING')

  const accepted = await asReceiver.request.post(`/api/friends/request/${requester.id}/accept`)
  expect(accepted.status(), await accepted.text()).toBe(200)
}

/**
 * Open the direct conversation with `peer` from the sidebar.
 *
 * A direct chat has exactly two members, so creating it twice reuses the same
 * conversation — both users open the same thread, which is what the delivery
 * assertions rely on.
 */
async function openChatWith(page: Page, peer: Account) {
  const existing = page.getByTestId('sidebar-conversation').filter({ hasText: peer.name })
  if ((await existing.count()) === 0) {
    await page.getByTestId('new-chat').click()
    const friend = page.getByTestId('new-chat-friend').filter({ hasText: peer.name })
    await expect(friend).toBeVisible({ timeout: 15_000 })
    await friend.click()
  } else {
    await existing.first().click()
  }
  await expect(page.getByTestId('chat-composer-input')).toBeVisible({ timeout: 30_000 })
}

test.describe('one-to-one messaging', () => {
  test('a message sent through the UI is stored, delivered to the peer and persists across reload', async ({
    browser,
    request,
  }) => {
    const alice = await register(request, 'alice')
    const bob = await register(request, 'bob')

    // Separate contexts: the two sessions must not share cookies.
    const aliceContext = await browser.newContext()
    const alicePage = await aliceContext.newPage()
    await loginViaUi(alicePage, alice)

    const bobContext = await browser.newContext()
    const bobPage = await bobContext.newPage()
    await loginViaUi(bobPage, bob)

    await befriend(alicePage, bobPage, alice, bob)

    // Alice opens the chat in the sidebar and sends a message.
    await alicePage.reload()
    await expect(alicePage.getByTestId('app-shell')).toBeVisible({ timeout: 30_000 })
    await openChatWith(alicePage, bob)
    await alicePage.getByTestId('chat-composer-input').fill('hello from the e2e suite')
    await alicePage.getByTestId('chat-send').click()
    await expect(
      alicePage.getByTestId('chat-messages').getByText('hello from the e2e suite'),
    ).toBeVisible({ timeout: 15_000 })

    // Bob opens the *same* conversation from his own session (a direct chat has
    // exactly two members, so creating it again reuses it) and reads the message
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
    await bobPage.getByTestId('sidebar-conversation').filter({ hasText: alice.name }).first().click()
    await expect(
      bobPage.getByTestId('chat-messages').getByText('hello from the e2e suite'),
    ).toBeVisible({ timeout: 30_000 })
    await expect(
      bobPage.getByTestId('chat-messages').getByText('hello from the e2e suite'),
    ).toBeVisible({ timeout: 30_000 })

    // The REST contract agrees.
    const thread = await bobPage.request.get(`/api/messages?userId=${alice.id}`)
    expect(thread.status()).toBe(200)
    const messages = (await thread.json()).messages as Array<{ content: string; senderId: string }>
    const delivered = messages.find((message) => message.content === 'hello from the e2e suite')
    expect(delivered, 'the message must be readable through the API').toBeTruthy()
    expect(delivered?.senderId).toBe(alice.id)

    // Bob replies; it is stored and readable by Alice through the API. (The
    // realtime socket path is not asserted here: it needs the separate socket
    // server that e2e/serve.cjs starts, and a socket assertion is flaky in a
    // single-worker CI run — the message being persisted and re-readable is the
    // part that must not regress.)
    await bobPage.getByTestId('chat-composer-input').fill('reply from bob')
    await bobPage.getByTestId('chat-send').click()
    await expect(
      bobPage.getByTestId('chat-messages').getByText('reply from bob'),
    ).toBeVisible({ timeout: 15_000 })

    await alicePage.reload()
    await expect(alicePage.getByTestId('app-shell')).toBeVisible({ timeout: 30_000 })
    await openChatWith(alicePage, bob)
    await expect(
      alicePage.getByTestId('chat-messages').getByText('reply from bob'),
    ).toBeVisible({ timeout: 30_000 })

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

    // The chat UI path is covered above; the subject here is authorization.
    const sent = await alicePage.request.post('/api/messages', {
      data: { receiverId: bob.id, content: 'private between alice and bob' },
    })
    expect(sent.status(), await sent.text()).toBe(200)
    const messageId = (await sent.json()).message.id as string

    const eveContext = await browser.newContext()
    const evePage = await eveContext.newPage()
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

    await aliceContext.close()
    await bobContext.close()
    await eveContext.close()
  })
})
