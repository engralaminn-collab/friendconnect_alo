import { test, expect } from '@playwright/test';

test('01 registration and login', async ({ page }) => {
  const ts = Date.now();
  const email = `pw_${ts}@test.local`;
  const username = `pw_${ts}`;
  // `baseURL` comes from playwright.config.ts (E2E_PORT); hard-coding a port
  // made the spec fail whenever the configured port differed.
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const title = await page.title().catch(() => '');
  if (title) expect(title).toMatch(/FriendConnect|Alo/i); else expect(await page.content()).toContain('FriendConnect');
  // Registration via API (UI form varies) — verify API
  const res = await page.request.post('/api/auth/register', {
    data: { name: 'PW User', username, email, password: 'Passw0rd!123' },
  });
  expect([201, 200]).toContain(res.status());
  // Duplicate should 409
  const dup = await page.request.post('/api/auth/register', {
    data: { name: 'PW User', username, email, password: 'Passw0rd!123' },
  });
  expect(dup.status()).toBe(409);
  // Jara impersonation 403. The email must be valid: an invalid one is rejected
  // by the zod schema with 400 before the reserved-identity check ever runs, so
  // `fake@local` would assert the wrong branch. Both the reserved username and
  // the reserved `jara@` mailbox prefix are covered.
  const reservedUsername = await page.request.post('/api/auth/register', {
    data: { name: 'Fake Jara', username: 'jara', email: 'fake@jara.example', password: 'Passw0rd!123' },
  });
  expect(reservedUsername.status()).toBe(403);
  const reservedMailbox = await page.request.post('/api/auth/register', {
    data: { name: 'Fake Jara', username: 'jara_impostor', email: 'jara@example.com', password: 'Passw0rd!123' },
  });
  expect(reservedMailbox.status()).toBe(403);
});
