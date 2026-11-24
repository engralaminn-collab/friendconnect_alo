import { defineConfig, devices } from '@playwright/test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/**
 * Playwright configuration for the end-to-end suite.
 *
 * Finding #13 fixed here:
 *  - the suite was never executed: there was no `test:e2e` script and CI did not
 *    install browsers, so `tests/e2e/*.spec.ts` were dead files;
 *  - the specs asserted nothing about the flows they claimed to cover;
 *  - `webServer` pointed at the real `db/custom.db`, so a run mutated development
 *    data (and depended on it existing).
 *
 * The server below always runs against a throwaway SQLite database in the
 * system temp directory, created fresh for the run.
 */

const PORT = Number(process.env.E2E_PORT ?? 3005)
const BASE_URL = `http://127.0.0.1:${PORT}`
const DB_FILE = join(tmpdir(), `friendconnect-e2e-${process.pid}.sqlite`)
const UPLOAD_DIR = join(tmpdir(), `friendconnect-e2e-uploads-${process.pid}`)

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  // A single worker: the specs register users and send messages against one
  // shared server, and the Jara governance spec changes global state.
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  // `json` feeds scripts/report-e2e-failures.mjs, which turns a failure into a
  // check-run annotation: the HTML report and traces are artifacts on blob
  // storage, which a reviewer may not be able to download, while annotations are
  // returned by the checks API.
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never' }], ['json', { outputFile: 'test-results/report.json' }]]
    : [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `node e2e/serve.cjs`,
    cwd: __dirname,
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      NODE_ENV: 'production',
      // The standalone build lives here; scripts/e2e-server.cjs runs it with the
      // right cwd and a clean database.
      APP_DIR: __dirname,
      DATABASE_URL: `file:${DB_FILE}`,
      UPLOAD_DIR,
      PORT: String(PORT),
      HOSTNAME: '127.0.0.1',
      SOCKET_PORT: String(PORT + 1),
      SOCKET_INTERNAL_URL: `http://127.0.0.1:${PORT + 1}`,
      NEXTAUTH_URL: BASE_URL,
      APP_ORIGIN: BASE_URL,
      NEXTAUTH_SECRET: 'e2e-only-not-a-production-secret',
      REDIS_URL: '',
    },
  },
})
