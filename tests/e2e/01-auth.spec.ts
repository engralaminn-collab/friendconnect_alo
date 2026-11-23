import { test, expect } from '@playwright/test';

test('01 registration and login', async ({ page }) => {
  const ts = Date.now();
  const email = `pw_${ts}@test.local`;
  const username = `pw_${ts}`;
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const title = await page.title().catch(() => '');
  if (title) expect(title).toMatch(/FriendConnect|Alo/i); else expect(await page.content()).toContain('FriendConnect');
  // Registration via API (UI form varies) — verify API
  const res = await page.request.post('http://127.0.0.1:3005/api/auth/register', {
    data: { name: 'PW User', username, email, password: 'Passw0rd!123' },
  });
  expect([201, 200]).toContain(res.status());
  // Duplicate should 409
  const dup = await page.request.post('http://127.0.0.1:3005/api/auth/register', {
    data: { name: 'PW User', username, email, password: 'Passw0rd!123' },
  });
  expect(dup.status()).toBe(409);
  // Jara impersonation 403
  const jara = await page.request.post('http://127.0.0.1:3005/api/auth/register', {
    data: { name: 'Fake Jara', username: 'jara', email: 'fake@local', password: 'Passw0rd!123' },
  });
  expect(jara.status()).toBe(403);
});
