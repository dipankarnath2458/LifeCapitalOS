import { defineConfig, devices } from '@playwright/test';

/**
 * Browser smoke tests for the critical signed-out and signed-in journeys.
 *
 * These exist because the two worst production defects this project has shipped — the
 * missing ThemeProvider that took `/app` down for every user, and sessions expiring after
 * 15 minutes — both compiled, both passed every test, and both were only caught by a human
 * opening a browser. Unit and API tests cannot see them.
 *
 * The suite boots the real API against a real Postgres and a production Next build, so what
 * it exercises is what deploys.
 */

const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 3100);
const API_PORT = Number(process.env.E2E_API_PORT ?? 4100);
const WEB_URL = `http://localhost:${WEB_PORT}`;
const API_URL = `http://127.0.0.1:${API_PORT}/api`;

// The API only allows origins it has been told about, and the web app inlines its API URL
// at build time — so both servers below must agree with these values.
const apiEnv = {
  ...process.env,
  NODE_ENV: 'development', // production mode refuses the dev secrets used here
  PORT: String(API_PORT),
  CORS_ORIGINS: WEB_URL,
  APP_URL: WEB_URL,
  // Emails are logged rather than sent; the suite never needs to read one.
  SANDBOX_RETURN_SECRETS: 'true',
} as Record<string, string>;

export default defineConfig({
  testDir: './e2e',
  // Journeys share a seeded account and assert on redirects, so they run in order.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: WEB_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node ../../apps/api/dist/main.js',
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      // The API's request log is one line per call and would bury the test output.
      // Errors still surface, and traces/screenshots are retained on failure.
      stdout: 'ignore',
      stderr: 'pipe',
      env: apiEnv,
    },
    {
      command: `npx next start -p ${WEB_PORT}`,
      url: WEB_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: { ...process.env, NEXT_PUBLIC_API_URL: API_URL } as Record<string, string>,
    },
  ],
});
