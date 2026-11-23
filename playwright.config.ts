import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:3005',
    trace: 'on-first-retry',
    screenshot: 'on',
    video: 'on',
  },
  webServer: {
    command: 'DATABASE_URL="file:./db/custom.db" PORT=3005 node .next/standalone/server.js',
    port: 3005,
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
