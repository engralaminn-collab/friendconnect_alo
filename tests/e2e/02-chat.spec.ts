import { test, expect, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test'

/**
 * One-to-one messaging, driven through the UI.
 *
 * Finding #13: the file this replaces was called "01 one-to-one messaging +
 * realtime" but never registered a session, never opened a conversation and
 * never sent a message — it asserted that `/api/jara/profile` returns the Jara
 * account. It passed while messaging was broken. Every step below exercises the
 * feature the test claims to cover, and fails when the feature regresses.
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

/** Sign in through the real login form. */
async function loginViaUi(page: Page, account: Account) {
  await page.goto('/')
  await page.getByTestId('auth-identifier').fill(account.username)
  await page.getByTestId('auth-password').fill(account.password)
  await page.getByTestId('auth-submit').click()
  // The SPA switches to the authenticated shell once /api/me succeeds.
  await expect(page.getByTestId('app-shell')).toBeVisible({ timeout: 30_000 })
}

test.describe('one-to-one messaging', () => {
  test('a message sent through the UI is stored, delivered to the peer and persists across reload', async ({
    browser,
    request,
  }) => {
    const alice = await register(request, 'alice')
    const bob = await register(request, 'bob')

    // Alice's session.
    const aliceContext: BrowserContext = await browser.newContext()
    const alicePage = await aliceContext.newPage()
    await loginViaUi(alicePage, alice)

    // Bob's session, in a separate browser context, so the two do not share
    // cookies — this is what makes the realtime delivery assertion meaningful.
    const bobContext: BrowserContext = await browser.newContext()
    const bobPage = await bobContext.newPage()
    await loginViaUi(bobPage, bob)

    // Alice opens Bob's profile and sends a friend request through the API that
    // the UI uses, then accepts from Bob's UI. Friending through the UI is
    // covered by the friends spec; here the focus is the chat.
    const requested = await alicePage.request.post('/api/friends', {
      data: { action: 'request', targetId: bob.id },
    })
    expect(requested.status(), await requested.text()).toBe(200)
    expect((await requested.json()).status).toBe('PENDING')

    await bobPage.reload()
    await expect(bobPage.getByTestId('app-shell')).toBeVisible()
    const accepted = await bobPage.request.post(`/api/friends/request/${alice.id}/accept`)
    expect(accepted.status(), await accepted.text()).toBe(200)

    // Alice opens the conversation with Bob and sends a message.
    await alicePage.goto(`/?view=chat&user=${bob.id}`)
    const composer = alicePage.getByTestId('chat-composer-input')
    await expect(composer).toBeVisible({ timeout: 30_000 })
    await composer.fill('hello from the e2e suite')
    await alicePage.getByTestId('chat-send').click()

    // It appears in Alice's thread.
    await expect(alicePage.getByText('hello from the e2e suite')).toBeVisible({ timeout: 15_000 })

    // Bob sees it too — via socket push or his own refresh — because the message
    // is persisted, not just echoed to the sender.
    await bobPage.goto(`/?view=chat&user=${alice.id}`)
    await expect(bobPage.getByText('hello from the e2e suite')).toBeVisible({ timeout: 30_000 })

    // It survives a full reload: it is in the database, not in client state.
    await bobPage.reload()
    await expect(bobPage.getByText('hello from the e2e suite')).toBeVisible({ timeout: 30_000 })

    // And the REST contract agrees.
    const thread = await bobPage.request.get(`/api/messages?userId=${alice.id}`)
    expect(thread.status()).toBe(200)
    const messages = (await thread.json()).messages as Array<{ content: string; senderId: string }>
    const delivered = messages.find((message) => message.content === 'hello from the e2e suite')
    expect(delivered, 'the message must be readable through the API').toBeTruthy()
    expect(delivered?.senderId).toBe(alice.id)

    // Bob replies and Alice receives it.
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

    // Seed a conversation directly through the API as Alice.
    const aliceContext = await browser.newContext()
    const alicePage = await aliceContext.newPage()
    await loginViaUi(alicePage, alice)

    await alicePage.request.post('/api/friends', { data: { action: 'request', targetId: bob.id } })
    const bobContext = await browser.newContext()
    const bobPage = await bobContext.newPage()
    await loginViaUi(bobPage, bob)
    const accepted = await bobPage.request.post(`/api/friends/request/${alice.id}/accept`)
    expect(accepted.status()).toBe(200)

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
    // Eve is not a participant: she gets the (empty) thread between her and
    // Alice, never Alice/Bob's messages.
    const eveMessages = ((await espionage.json()).messages ?? []) as Array<{ content: string }>
    expect(eveMessages.map((m) => m.content)).not.toContain('private between alice and bob')

    const reaction = await evePage.request.post(`/api/messages/${messageId}/reactions`, {
      data: { emoji: '\u{1F44D}' },
    })
    expect(reaction.status(), 'a non-participant must not be able to react').toBe(404)

    await aliceContext.close()
    await bobContext.close()
    await eveContext.close()
  })
})
