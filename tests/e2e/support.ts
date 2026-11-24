import { expect, type APIRequestContext, type Browser, type Page, type TestInfo } from '@playwright/test'
import { appendFileSync, mkdirSync } from 'node:fs'

/**
 * Shared helpers for the browser specs.
 *
 * The interesting part is `trackedPage`: a browser cannot be installed in every
 * environment this repository is worked on in, so when a spec fails in CI the
 * only evidence is what the spec itself records. Every page created through this
 * helper keeps its console errors, page errors and failed requests, and
 * `dumpDiagnostics` writes them — plus the rendered body text — to
 * `test-results/diagnostics.txt` on failure. `scripts/report-e2e-failures.mjs`
 * then publishes that file as a check-run annotation.
 */

export interface Account {
  name: string
  username: string
  email: string
  password: string
  id: string
}

export const PASSWORD = 'Passw0rd!123'

interface Tracked {
  label: string
  page: Page
  logs: string[]
}

const tracked: Tracked[] = []

/** A fresh browser context whose page records console/page/request errors. */
export async function trackedPage(browser: Browser, label: string): Promise<Page> {
  const context = await browser.newContext()
  const page = await context.newPage()
  const logs: string[] = []
  page.on('pageerror', (error) => logs.push(`[pageerror] ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') logs.push(`[console.error] ${message.text().slice(0, 400)}`)
  })
  page.on('requestfailed', (request) =>
    logs.push(`[requestfailed] ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`),
  )
  // Record API traffic: knowing which calls the app made and what they returned is
  // what distinguishes "the server has no data" from "the client dropped it".
  page.on('response', async (response) => {
    const url = response.url()
    if (!url.includes('/api/')) return
    let detail = ''
    if (/\/api\/(conversations|me|friends)(\?|$)/.test(url)) {
      try {
        const text = await response.text()
        detail = ` ${text.slice(0, 300)}`
      } catch {
        detail = ' (body unavailable)'
      }
    }
    logs.push(`[api] ${response.status()} ${response.request().method()} ${new URL(url).pathname}${detail}`)
  })
  tracked.push({ label, page, logs })
  return page
}

/**
 * Write everything recorded for this test attempt, but only when it failed.
 * Appends, so a retry does not erase the first attempt's evidence.
 */
export async function dumpDiagnostics(testInfo: TestInfo) {
  if (testInfo.status === testInfo.expectedStatus) return
  const lines: string[] = [`\n##### attempt ${testInfo.retry + 1}: ${testInfo.title} — ${testInfo.status}`]
  for (const { label, page, logs } of tracked) {
    lines.push(`=== ${label} (url: ${page.url()}) ===`)
    if (logs.length === 0) lines.push('(no console, page or request errors)')
    lines.push(...logs.slice(-15))
    try {
      const body = (await page.locator('body').innerText()).replace(/\n{2,}/g, '\n').slice(0, 1200)
      lines.push('--- rendered text ---', body || '(empty body)')
    } catch (error) {
      lines.push(`--- rendered text unavailable: ${(error as Error).message.slice(0, 200)}`)
    }
    try {
      const rows = await page.getByTestId('sidebar-conversation').count()
      lines.push(`--- sidebar conversation rows: ${rows}`)
    } catch {
      // ignore
    }
    // The same session's view of the data at failure time.
    for (const path of ['/api/me', '/api/conversations']) {
      try {
        const response = await page.request.get(path)
        const text = await response.text()
        lines.push(`--- GET ${path} -> ${response.status()} ${text.replace(/\s+/g, ' ').slice(0, 500)}`)
      } catch (error) {
        lines.push(`--- GET ${path} failed: ${(error as Error).message.slice(0, 200)}`)
      }
    }
  }
  try {
    mkdirSync('test-results', { recursive: true })
    appendFileSync('test-results/diagnostics.txt', `${lines.join('\n')}\n`)
  } catch {
    // Diagnostics must never turn a test failure into a different failure.
  }
}

export async function register(request: APIRequestContext, label: string): Promise<Account> {
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

/**
 * Sign in on the real sign-in screen.
 *
 * `src/app/page.tsx` renders `components/chat/AuthScreen.tsx`; the similarly named
 * `components/fc/auth/AuthFlow.tsx` is never mounted, and test ids placed there
 * (an earlier attempt) were invisible to the browser.
 */
export async function loginViaUi(page: Page, account: Account) {
  await page.goto('/')
  await expect(page.getByTestId('auth-identifier')).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('auth-identifier').fill(account.username)
  await page.getByTestId('auth-password').fill(account.password)
  await page.getByTestId('auth-submit').click()
  await expect(page.getByTestId('app-shell')).toBeVisible({ timeout: 30_000 })
}

/**
 * Become friends. `POST /api/friends/request/<id>/accept` takes the *requester's*
 * user id (the route's `id` is the other party, not the request row).
 */
export async function befriend(
  asRequester: Page,
  asReceiver: Page,
  requester: Account,
  receiver: Account,
) {
  const requested = await asRequester.request.post('/api/friends', {
    data: { action: 'request', targetId: receiver.id },
  })
  expect(requested.status(), await requested.text()).toBe(200)
  expect((await requested.json()).status).toBe('PENDING')

  const accepted = await asReceiver.request.post(`/api/friends/request/${requester.id}/accept`)
  expect(accepted.status(), await accepted.text()).toBe(200)
}

/**
 * Open the direct conversation with `peer` the way a user does: from the
 * sidebar, or — when it does not exist yet — through the New chat dialog.
 *
 * A direct conversation has exactly two members, so creating it twice reuses the
 * same thread; both users therefore open the same conversation.
 */
export async function openChatWith(page: Page, peer: Account) {
  const existing = page.getByTestId('sidebar-conversation').filter({ hasText: peer.name })
  await expect(existing.or(page.getByTestId('new-chat'))).toBeVisible({ timeout: 30_000 })
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

/** Open an already-listed conversation from the sidebar and wait for its pane. */
export async function openListedChatWith(page: Page, peer: Account) {
  await page.getByTestId('sidebar-conversation').filter({ hasText: peer.name }).first().click()
  await expect(page.getByTestId('chat-composer-input')).toBeVisible({ timeout: 30_000 })
}
