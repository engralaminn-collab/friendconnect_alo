import { test, expect } from '@playwright/test'

/**
 * API-level contract assertions that the browser specs build on.
 *
 * These exist because the browser-level specs silently rotted: `01-auth.spec.ts`
 * asserted a 403 for a request that a *different* branch rejects with 400, and
 * `02-chat.spec.ts` navigated to a URL route the app does not have. Neither could
 * be noticed without a browser, and neither is a UI property — they are API
 * contracts. Asserting them here means a breaking change fails with a readable
 * message even if a later UI change makes the interaction specs hard to read.
 *
 * Playwright's `request` fixture resolves paths against `baseURL`, so these run
 * against the same throwaway server the UI specs use.
 */

test.describe('authentication contract', () => {
  test('registration validates input, then refuses the reserved Jara identity', async ({ request }) => {
    const unique = `contract_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`.toLowerCase()
    const credentials = {
      name: 'Contract User',
      username: unique,
      email: `${unique}@e2e.invalid`,
      password: 'Passw0rd!123',
    }

    const created = await request.post('/api/auth/register', { data: credentials })
    expect(created.status(), await created.text()).toBe(201)
    expect((await created.json()).user.id).toBeTruthy()

    const duplicate = await request.post('/api/auth/register', { data: credentials })
    expect(duplicate.status()).toBe(409)

    // Invalid input is rejected by the schema before the reserved-identity check,
    // so this is a 400 — asserting 403 here is what hid the real contract.
    const invalidEmail = await request.post('/api/auth/register', {
      data: { name: 'Fake Jara', username: 'jara', email: 'fake@local', password: 'Passw0rd!123' },
    })
    expect(invalidEmail.status()).toBe(400)

    // Reserved username, with a valid email, reaches the identity guard.
    const reservedUsername = await request.post('/api/auth/register', {
      data: { name: 'Fake Jara', username: 'jara', email: 'fake@jara.example', password: 'Passw0rd!123' },
    })
    expect(reservedUsername.status()).toBe(403)

    // The reserved `jara@` mailbox is refused for any username.
    const reservedMailbox = await request.post('/api/auth/register', {
      data: { name: 'Fake Jara', username: 'jara_impostor', email: 'jara@example.com', password: 'Passw0rd!123' },
    })
    expect(reservedMailbox.status()).toBe(403)
  })
})
