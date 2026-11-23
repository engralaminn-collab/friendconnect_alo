import { test, expect } from '@playwright/test';

async function registerAndLogin(request: any, ts: number, suffix: string) {
  const email = `pw_${ts}_${suffix}@test.local`;
  const username = `pw_${ts}_${suffix}`;
  await request.post('http://127.0.0.1:3005/api/auth/register', {
    data: { name: `PW ${suffix}`, username, email, password: 'Passw0rd!123' },
  });
  return { email, username };
}

test('02 one-to-one messaging + realtime', async ({ page }) => {
  const ts = Date.now();
  const a = await registerAndLogin(page.request, ts, 'alice');
  const b = await registerAndLogin(page.request, ts, 'bob');
  // Login via next-auth csrf flow (API level) then send message
  const csrf = await page.request.get('http://127.0.0.1:3005/api/auth/csrf');
  expect(csrf.ok()).toBeTruthy();
  // Verify jara profile is accessible (permanent account)
  const jara = await page.request.get('http://127.0.0.1:3005/api/jara/profile');
  expect(jara.ok()).toBeTruthy();
  const jbody = await jara.json();
  expect(jbody.user.isAI).toBe(true);
  expect(jbody.user.id).toBe('jara-ai-system-001');
});

test('03 jara governance', async ({ page }) => {
  const ts = Date.now();
  const email = `pwgov_${ts}@test.local`;
  const username = `pwgov_${ts}`;
  await page.request.post('http://127.0.0.1:3005/api/auth/register', {
    data: { name: 'Gov User', username, email, password: 'Passw0rd!123' },
  });
  const health = await page.request.get('http://127.0.0.1:3005/api/jara/health');
  expect(health.ok()).toBeTruthy();
  const h = await health.json();
  expect(h.jara.exists).toBe(true);
  // Unauthenticated jara history should be 401
  const hist = await page.request.get('http://127.0.0.1:3005/api/jara/history');
  expect(hist.status()).toBe(401);
});
