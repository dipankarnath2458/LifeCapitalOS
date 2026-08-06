import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Critical-path smoke tests.
 *
 * Scope is deliberately narrow: the journeys where a regression means nobody can use the
 * product. Feature behaviour belongs in the API e2e suite, which is far cheaper to run.
 *
 * Every assertion here maps to something that has actually broken in production:
 *  - `/app` rendering at all (a missing ThemeProvider took the route down for every user)
 *  - staying signed in (access tokens expired with no refresh)
 *  - signing out (left a 30-day refresh token alive server-side)
 *  - reaching password reset (the page did not exist, and nothing linked to it)
 *  - a wrong password showing an error instead of navigating
 *
 * **These tests must not depend on database history.** CI starts from a fresh Postgres but
 * a developer's does not, and an earlier run leaves firms and accounts behind. So each
 * journey provisions the account shape it needs rather than assuming one.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? `http://127.0.0.1:${process.env.E2E_API_PORT ?? 4100}/api`;
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@lifecapitalos.dev';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'Admin@12345';
const PASSWORD = 'SmokeTest1pass';

/** Signs in through the real form and waits for the app shell. */
async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.fill('input[type=email]', email);
  await page.fill('input[type=password]', password);
  await page.click('button:has-text("Sign in")');
  await page.waitForURL('**/app');
}

/** Registers a fresh account straight through the API. Belongs to no firm by construction. */
async function createAccount(request: APIRequestContext): Promise<string> {
  const email = `smoke_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
  const res = await request.post(`${API_URL}/auth/register`, {
    data: { email, password: PASSWORD, fullName: 'Smoke Test' },
  });
  expect(res.ok()).toBeTruthy();
  return email;
}

test.describe('public site', () => {
  test('landing page renders and links to sign-in', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Know Your Financial Health/i })).toBeVisible();
    await page.getByRole('link', { name: 'Log in' }).click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('the app section is not reachable without signing in', async ({ page }) => {
    await page.goto('/app');
    await expect(page).toHaveURL(/\/login$/);
  });
});

test.describe('authentication', () => {
  // A firm-less account, so `/app` deterministically shows the empty state.
  let email: string;
  test.beforeAll(async ({ request }) => {
    email = await createAccount(request);
  });

  test('a wrong password shows an error and stays on the login page', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type=email]', email);
    await page.fill('input[type=password]', 'definitely-not-the-password');
    await page.click('button:has-text("Sign in")');

    await expect(page.getByText(/Invalid email or password/i)).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('sign in reaches the authenticated shell and stores a session', async ({ page }) => {
    await signIn(page, email, PASSWORD);

    // The shell must RENDER. A crash here is the exact failure mode that took /app down.
    await expect(page.getByText(/No firm yet/)).toBeVisible();

    const session = await page.evaluate(() => ({
      access: localStorage.getItem('lcos_access'),
      refresh: localStorage.getItem('lcos_refresh'),
    }));
    expect(session.access).toBeTruthy();
    expect(session.refresh).toBeTruthy();
  });

  test('the session survives a reload', async ({ page }) => {
    await signIn(page, email, PASSWORD);
    await page.reload();
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByText(/No firm yet/)).toBeVisible();
  });

  test('sign out clears the session and returns to login', async ({ page }) => {
    await signIn(page, email, PASSWORD);
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.waitForURL('**/login');

    const access = await page.evaluate(() => localStorage.getItem('lcos_access'));
    expect(access).toBeNull();

    // Going back to /app must not resurrect the session.
    await page.goto('/app');
    await expect(page).toHaveURL(/\/login$/);
  });
});

test.describe('account recovery', () => {
  test('password reset is reachable from the login page and accepts a request', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('link', { name: /Forgot your password/i }).click();
    await expect(page).toHaveURL(/\/forgot-password$/);

    // A fresh address each run: the API throttles reset requests to 3 per address per 15
    // minutes, so reusing one couples the test to how recently the suite last ran. The
    // confirmation is deliberately identical for unknown addresses — that IS the privacy
    // property — so an unregistered address exercises the same UI.
    await page.fill('input[type=email]', `reset_probe_${Date.now()}@example.com`);
    await page.click('button:has-text("Send reset link")');
    await expect(page.getByText(/Check your email/i)).toBeVisible();
  });

  test('an incomplete reset link is rejected rather than rendering a broken form', async ({ page }) => {
    await page.goto('/reset-password');
    await expect(page.getByText(/Link is incomplete/i)).toBeVisible();
  });

  test('an invalid verification link offers a way to get a new one', async ({ page }) => {
    await page.goto(`/verify-email?email=${encodeURIComponent(ADMIN_EMAIL)}&token=${'0'.repeat(64)}`);
    await expect(page.getByText(/Link has expired/i)).toBeVisible();
  });
});

test.describe('advisor workspace', () => {
  /**
   * The one that matters most.
   *
   * `/app` renders one of two things: an empty state when the caller belongs to no firm, or
   * the full `DashboardLayout` when they do. Only the second path mounts TopNav →
   * ThemeToggle → useTheme — which is exactly what threw "useTheme must be used within a
   * <ThemeProvider>" and took the route down for every real user.
   *
   * Every test above signs in as a firm-less account and never reaches that code. This one
   * provisions a firm first, so the crash path is genuinely covered. Confirmed by removing
   * the ThemeProvider and checking that this test — and only this test — fails.
   */
  test('the full dashboard shell renders for a user with a firm', async ({ page }) => {
    await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD);

    // Provisioned through the API rather than the seed, so the seed stays exactly what
    // production runs. Idempotent: reuses a firm from an earlier run if one exists.
    const provisioned = await page.evaluate(async (base) => {
      const token = localStorage.getItem('lcos_access');
      const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

      const mine = await (await fetch(`${base}/firms/me`, { headers })).json();
      if (mine.firms?.length) return true;

      const me = await (await fetch(`${base}/auth/me`, { headers })).json();
      const res = await fetch(`${base}/firms`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'Smoke Test Advisory', ownerUserId: me.id }),
      });
      return res.ok;
    }, API_URL);
    expect(provisioned).toBe(true);

    await page.reload();

    // Sidebar navigation exists only inside DashboardLayout — the component tree that
    // reaches useTheme. `.first()` because the nav is rendered for desktop and mobile.
    await expect(page.getByRole('link', { name: 'Book overview' }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Households' }).first()).toBeVisible();
    await expect(page.getByText('Advisor workspace').first()).toBeVisible();
    await expect(page.getByText(/No firm yet/)).toHaveCount(0);
  });
});

test.describe('new user registration', () => {
  test('a new account can be created through the form and lands signed in', async ({ page }) => {
    const email = `smoke_signup_${Date.now()}@example.com`;

    await page.goto('/login');
    await page.getByRole('button', { name: /New here\? Create an account/i }).click();
    await page.fill('input[placeholder="Your name"]', 'Smoke Test');
    await page.fill('input[type=email]', email);
    await page.fill('input[type=password]', PASSWORD);
    await page.click('button:has-text("Create account")');

    await page.waitForURL('**/app');
    // A brand-new account belongs to no firm — the empty state must render, not crash.
    await expect(page.getByText(/No firm yet/i)).toBeVisible();
  });
});
