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

/**
 * Signs in through the real form and waits for wherever the user belongs.
 *
 * V2 is the primary consumer experience: advisors land on /app, consumers on /household,
 * and a consumer with no household is forwarded to /onboarding.
 */
async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.fill('input[type=email]', email);
  await page.fill('input[type=password]', password);
  await page.click('button:has-text("Sign in")');
  await page.waitForURL(/\/(app|household|onboarding)$/);
}

/**
 * Gives the account a household, so it is a RETURNING consumer.
 *
 * V2 forwards a consumer with no household to /onboarding — that redirect is now the only
 * entry point into onboarding in the product. Tests that need a settled consumer must
 * therefore provision a household server-side, not just set a localStorage flag: the flag
 * governed the old V1 nudge and no longer decides anything for V2.
 */
async function asReturningConsumer(page: Page, request: APIRequestContext, email: string): Promise<void> {
  const login = await request.post(`${API_URL}/auth/login`, { data: { email, password: PASSWORD } });
  const { accessToken } = await login.json();
  const res = await request.post(`${API_URL}/onboarding/household`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    data: {},
  });
  expect(res.ok()).toBeTruthy();
  await page.addInitScript(() => localStorage.setItem('lcos_onboarded', '1'));
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

  test('sign in reaches the authenticated shell and stores a session', async ({ page, request }) => {
    // As a RETURNING consumer: a first-run account is redirected on to /onboarding, and
    // reading localStorage mid-navigation destroys the execution context. This test is
    // about the session being stored, not about first-run routing — which the consumer
    // onboarding tests below cover directly.
    await asReturningConsumer(page, request, email);
    await signIn(page, email, PASSWORD);

    // The regression this guards: a firm-less user must NOT be sent to the Advisor
    // Workspace, and must never see the "No firm yet" dead end.
    await expect(page).not.toHaveURL(/\/app$/);
    await expect(page.getByText(/No firm yet/)).toHaveCount(0);

    const session = await page.evaluate(() => ({
      access: localStorage.getItem('lcos_access'),
      refresh: localStorage.getItem('lcos_refresh'),
    }));
    expect(session.access).toBeTruthy();
    expect(session.refresh).toBeTruthy();
  });

  test('a returning consumer lands on the V2 household dashboard', async ({ page, request }) => {
    await asReturningConsumer(page, request, email);
    await signIn(page, email, PASSWORD);
    await expect(page).toHaveURL(/\/household$/);
  });

  test('the session survives a reload', async ({ page, request }) => {
    await asReturningConsumer(page, request, email);
    await signIn(page, email, PASSWORD);
    await page.reload();
    await expect(page).toHaveURL(/\/household$/);
  });

  test('sign out clears the session and returns to login', async ({ page, request }) => {
    await asReturningConsumer(page, request, email);
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

test.describe('consumer cannot reach the advisor workspace', () => {
  test('a consumer typing /app is redirected to the consumer home', async ({ page, request }) => {
    // Renamed from "firm-less": since onboarding gives every consumer a personal firm, no
    // onboarded consumer is firm-less any more. Gating /app on firm membership alone
    // therefore let a consumer walk straight into the Advisor Workspace by typing the URL.
    const consumer = await createAccount(request);
    await asReturningConsumer(page, request, consumer);
    await signIn(page, consumer, PASSWORD);

    await page.goto('/app');
    await expect(page).toHaveURL(/\/household$/);
    await expect(page.getByText(/No firm yet/)).toHaveCount(0);
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

test.describe('consumer onboarding', () => {
  /**
   * The regression this guards is the one M5.5 PR-1/PR-2 exist to fix.
   *
   * Onboarding used to write a profile, an account and a goal — all on the retail
   * (`userId`) path — and never create a household. `FinancialSnapshot` and
   * `FinancialHealthScore` are household-only, so a consumer could complete every step and
   * still be unable to get a Wealth Health Check, a health score, or any AI insight.
   * Onboarding looked complete and left the account unusable.
   *
   * So this asserts the outcome (a household exists), not the appearance (the wizard
   * advanced). Nothing on screen would have shown the difference.
   */
  test('the first step provisions a household', async ({ page, request }) => {
    // No navigation of our own: a first-run consumer is routed to /onboarding by the
    // dashboard, and racing that redirect with a goto() aborts it. Arriving the way a real
    // user does also means this covers the first-run route itself.
    const consumer = await createAccount(request);
    await signIn(page, consumer, PASSWORD);
    await page.waitForURL(/\/onboarding$/);

    await expect(page.getByRole('heading', { name: /Who are we planning for/i })).toBeVisible();
    await page.fill('input[placeholder="The Sharmas"]', 'Playwright Family');
    await page.getByRole('button', { name: 'Continue' }).click();

    // Advancing to step 2 is the UI signal; the household is the actual deliverable.
    await expect(page.getByRole('heading', { name: 'About you' })).toBeVisible();

    const status = await page.evaluate(async (base) => {
      const res = await fetch(`${base}/onboarding/status`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('lcos_access')}` },
      });
      return res.json();
    }, API_URL);
    expect(status.hasHousehold).toBe(true);
    expect(status.householdId).toBeTruthy();
  });

  test('skipping still leaves a usable account rather than a dead end', async ({ page, request }) => {
    // Skipping is the most common path through any wizard. A skipped consumer with no
    // household would reach a dashboard that can never compute anything for them.
    const consumer = await createAccount(request);
    await signIn(page, consumer, PASSWORD);
    await page.waitForURL(/\/onboarding$/);

    await page.getByRole('button', { name: 'Skip for now' }).click();
    await page.waitForURL(/\/(household|app)$/);

    const status = await page.evaluate(async (base) => {
      const res = await fetch(`${base}/onboarding/status`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('lcos_access')}` },
      });
      return res.json();
    }, API_URL);
    expect(status.hasHousehold).toBe(true);
  });
});

test.describe('wealth health check', () => {
  /**
   * The consumer's first real output from the platform.
   *
   * Asserts the SCORE REFLECTS THE FIGURES ENTERED, not merely that a number rendered.
   * Two silent failures make that distinction the whole point: writing accounts to the
   * retail path instead of the household path, or collecting income without creating
   * transactions, both produce a plausible-looking score computed on nothing.
   *
   * The figures below describe a healthy family — 20L of assets, 5L of debt, saving half
   * their income — so a score computed on an empty snapshot would land far below this
   * threshold. See docs/M5_5_WEALTH_HEALTH_CHECK_ARCHITECTURE.md.
   */
  test('produces a score computed from the figures entered', async ({ page, request }) => {
    const consumer = await createAccount(request);
    await asReturningConsumer(page, request, consumer);
    await signIn(page, consumer, PASSWORD);
    await page.goto('/wealth-health');

    await page.getByLabel('Cash & savings (₹)').fill('600000');
    await page.getByLabel('Investments (₹)').fill('1400000');
    await page.getByRole('button', { name: 'Continue' }).click();

    await page.getByLabel('Outstanding loan balance (₹)').fill('500000');
    await page.getByLabel('Monthly payment (₹)').fill('15000');
    await page.getByLabel('Interest rate (% a year)').fill('9');
    await page.getByRole('button', { name: 'Continue' }).click();

    await page.getByLabel('Monthly income (₹)').fill('200000');
    await page.getByLabel('Monthly expenses (₹)').fill('100000');
    await page.getByRole('button', { name: 'See my score' }).click();

    await expect(page.getByRole('heading', { name: 'Your Wealth Health' })).toBeVisible();
    const overall = Number((await page.getByTestId('overall-score').innerText()).split('/')[0]);
    expect(overall).toBeGreaterThan(50);

    // The per-category explanations come from the scoring model. If cashflow never
    // reached the snapshot this reads "No income recorded for this period".
    await expect(page.getByText(/No income recorded/i)).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Savings' })).toBeVisible();
  });
});

test.describe('household dashboard', () => {
  /**
   * M5.6 — the canonical consumer of the V2 Financial Intelligence Layer.
   *
   * Asserts the page shows the family's ACTUAL position. The failure this guards is a
   * dashboard that renders confidently from an empty or stale snapshot: ₹0 net worth and
   * an unknown net worth are indistinguishable once drawn, and only one of them is true.
   *
   * See docs/M5_6_HOUSEHOLD_DASHBOARD_ARCHITECTURE.md.
   */
  test('shows the figures from the snapshot the check captured', async ({ page, request }) => {
    const consumer = await createAccount(request);
    await asReturningConsumer(page, request, consumer);
    await signIn(page, consumer, PASSWORD);

    // Complete a check so a snapshot exists — the dashboard reads, it never captures.
    await page.goto('/wealth-health');
    await page.getByLabel('Cash & savings (₹)').fill('900000');
    await page.getByLabel('Investments (₹)').fill('1100000');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel('Monthly income (₹)').fill('300000');
    await page.getByLabel('Monthly expenses (₹)').fill('150000');
    await page.getByRole('button', { name: 'See my score' }).click();
    await expect(page.getByRole('heading', { name: 'Your Wealth Health' })).toBeVisible();

    await page.getByRole('button', { name: 'Go to my dashboard' }).click();
    await expect(page).toHaveURL(/\/household$/);

    // ₹20,00,000 of assets and no debt. A dashboard reading an empty snapshot would show
    // ₹0 here, which is the whole point of asserting the value rather than the render.
    await expect(page.getByTestId('net-worth')).toContainText('20,00,000');
    const score = Number((await page.getByTestId('overall-score').innerText()).split('/')[0]);
    expect(score).toBeGreaterThan(0);

    // Provenance is shown, so any number here can be traced back to its snapshot.
    await expect(page.getByText(/Based on your snapshot/i)).toBeVisible();
  });

  test('subtracts a loan the family entered, and shows the loan itself', async ({
    page,
    request,
  }) => {
    // The defect, at the surface a family actually sees. The wizard writes loans to the
    // debt ledger and never as liability accounts, and the dashboard reported the
    // accounts-only net worth — so a family who typed a ₹4,00,000 loan into this very
    // wizard was shown ₹20,00,000 net worth, ₹0 liabilities, and no loan anywhere.
    const consumer = await createAccount(request);
    await asReturningConsumer(page, request, consumer);
    await signIn(page, consumer, PASSWORD);

    await page.goto('/wealth-health');
    await page.getByLabel('Cash & savings (₹)').fill('900000');
    await page.getByLabel('Investments (₹)').fill('1100000');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel('Outstanding loan balance (₹)').fill('400000');
    await page.getByLabel('Monthly payment (₹)').fill('12000');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel('Monthly income (₹)').fill('300000');
    await page.getByLabel('Monthly expenses (₹)').fill('150000');
    await page.getByRole('button', { name: 'See my score' }).click();
    await expect(page.getByRole('heading', { name: 'Your Wealth Health' })).toBeVisible();

    await page.getByRole('button', { name: 'Go to my dashboard' }).click();
    await expect(page).toHaveURL(/\/household$/);

    // ₹20,00,000 of assets less a ₹4,00,000 loan.
    await expect(page.getByTestId('net-worth')).toContainText('16,00,000');
    // And the loan is on the page, not merely subtracted out of sight.
    await expect(page.getByText('Loans')).toBeVisible();
    await expect(page.getByText('4,00,000')).toBeVisible();
  });

  test('re-running the check updates the figures instead of doubling them', async ({
    page,
    request,
  }) => {
    // The defect at the surface a family touches. Before this, revisiting "Update my figures"
    // and submitting the same numbers doubled their net worth, with nothing to warn them.
    const consumer = await createAccount(request);
    await asReturningConsumer(page, request, consumer);
    await signIn(page, consumer, PASSWORD);

    await page.goto('/wealth-health');
    await page.getByLabel('Cash & savings (₹)').fill('900000');
    await page.getByLabel('Investments (₹)').fill('1100000');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel('Outstanding loan balance (₹)').fill('400000');
    await page.getByLabel('Monthly payment (₹)').fill('12000');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel('Monthly income (₹)').fill('300000');
    await page.getByLabel('Monthly expenses (₹)').fill('150000');
    await page.getByRole('button', { name: 'See my score' }).click();
    await expect(page.getByRole('heading', { name: 'Your Wealth Health' })).toBeVisible();
    await page.getByRole('button', { name: 'Go to my dashboard' }).click();
    await expect(page.getByTestId('net-worth')).toContainText('16,00,000');

    // Return to the check the way a consumer does — the dashboard's own button.
    await page.getByRole('button', { name: 'Update my figures' }).click();
    await expect(page).toHaveURL(/\/wealth-health$/);

    // Prefilled with what they already told us, not blank. This is the half of the fix a
    // browser can see, and the reason someone stopped re-entering one number into an empty
    // form while the rest silently accumulated.
    await expect(page.getByLabel('Cash & savings (₹)')).toHaveValue('900000');
    await expect(page.getByLabel('Investments (₹)')).toHaveValue('1100000');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByLabel('Outstanding loan balance (₹)')).toHaveValue('400000');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByLabel('Monthly income (₹)')).toHaveValue('300000');
    await expect(page.getByLabel('Monthly expenses (₹)')).toHaveValue('150000');

    // Submit unchanged. Nothing about the family's position has changed, so nothing on the
    // dashboard may change either.
    await page.getByRole('button', { name: 'See my score' }).click();
    await expect(page.getByRole('heading', { name: 'Your Wealth Health' })).toBeVisible();
    await page.getByRole('button', { name: 'Go to my dashboard' }).click();
    await expect(page.getByTestId('net-worth')).toContainText('16,00,000');
    await expect(page.getByText('₹32,00,000')).toHaveCount(0);
  });

  test('invites a consumer with no data to run the check, rather than showing zeros', async ({
    page,
    request,
  }) => {
    const consumer = await createAccount(request);
    await asReturningConsumer(page, request, consumer);
    await signIn(page, consumer, PASSWORD);

    // Provision the household WITHOUT capturing a snapshot. This is the realistic state:
    // since onboarding provisions a household for everyone, every real consumer arrives
    // here with a household and no snapshot. Testing only the no-household case would
    // exercise a branch almost nobody hits — confirmed by sabotaging the no-snapshot
    // branch and watching this test still pass.
    await page.evaluate(async (base) => {
      await fetch(`${base}/onboarding/household`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('lcos_access')}`,
        },
        body: '{}',
      });
    }, API_URL);

    await page.goto('/household');

    await expect(page.getByText(/Let's build your financial picture/i)).toBeVisible();
    // The distinction that matters: no fabricated figures anywhere on the empty state.
    await expect(page.getByTestId('net-worth')).toHaveCount(0);
    await expect(page.getByTestId('overall-score')).toHaveCount(0);

    await page.getByRole('button', { name: /Start my Wealth Health Check/i }).click();
    await expect(page).toHaveURL(/\/wealth-health$/);
  });
});

test.describe('consumer routing after onboarding', () => {
  /**
   * The gap that let a production defect ship: **no test ever logged in AGAIN after
   * onboarding.** Every routing test used a firm-less account — the one state that stops
   * existing the moment a consumer onboards and is given a personal firm.
   *
   * From then on `firms.length > 0` was true for consumers too, and post-login routing sent
   * them to the Advisor Workspace. Nothing errored; they simply landed in the wrong product.
   */
  test('an onboarded consumer signing in again reaches the consumer home, not the advisor workspace', async ({
    page,
    request,
  }) => {
    const consumer = await createAccount(request);

    // Onboard through the API, then sign in fresh — the second login is the whole point.
    const login = await request.post(`${API_URL}/auth/login`, {
      data: { email: consumer, password: PASSWORD },
    });
    const { accessToken } = await login.json();
    const provisioned = await request.post(`${API_URL}/onboarding/household`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      data: {},
    });
    expect(provisioned.ok()).toBeTruthy();

    await asReturningConsumer(page, request, consumer);
    await signIn(page, consumer, PASSWORD);

    await expect(page).not.toHaveURL(/\/app$/);
    await expect(page.getByText(/Advisor workspace/i)).toHaveCount(0);
  });

  test('an advisor with a firm still reaches the advisor workspace', async ({ page }) => {
    // The other half: the fix must not push advisors into the consumer experience.
    await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByText('Advisor workspace').first()).toBeVisible();
  });
});

test.describe('V2 primary / V1 safety net', () => {
  /**
   * PR A — V2 becomes the primary consumer experience while V1 stays operational.
   * See docs/V2_PRIMARY_MIGRATION_PLAN.md.
   *
   * These assert the two halves of that arrangement directly, because both fail SILENTLY:
   * a capability that quietly disappears produces no error, and a rollback path that has
   * stopped working looks identical to one that works until you need it.
   */

  test('a NEW consumer reaches the V2 experience, not V1', async ({ page, request }) => {
    // Deliberately no household: this proves the redirect that is now the ONLY entry point
    // into onboarding in the product. It used to live on the V1 dashboard.
    const consumer = await createAccount(request);
    await signIn(page, consumer, PASSWORD);
    await expect(page).toHaveURL(/\/onboarding$/);
  });

  test('the V1 dashboard is still reachable and renders — the rollback path', async ({
    page,
    request,
  }) => {
    // Guards rules 3, 4 and 10. If reverting CONSUMER_HOME is the rollback, then /dashboard
    // must still work at the moment we need it — not merely still exist in the repository.
    const consumer = await createAccount(request);
    await asReturningConsumer(page, request, consumer);
    await signIn(page, consumer, PASSWORD);

    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('heading', { name: /Family Balance Sheet/i })).toBeVisible();
  });

  test('every preserved capability is reachable and working from V2', async ({ page, request }) => {
    // Guards rules 2, 5, 6 and 7. Asserts a WORKING CONTROL on each surface, not just a
    // heading — a page that renders a title but cannot save is functionality lost.
    const consumer = await createAccount(request);
    await asReturningConsumer(page, request, consumer);
    await signIn(page, consumer, PASSWORD);

    // Every one of these was a hosted V1 component behind a "temporary surface" notice. AI coach
    // went native in M5.7, Family in M5.8 PR 1, Goals in PR 2 and Protection in M5.9 — so the
    // list is now checked for the OPPOSITE property. Each must be reachable, native, and carry a
    // working control; a page that renders a title but cannot save is functionality lost.
    for (const link of ['Goals', 'Family', 'Protection', 'AI coach']) {
      await page.goto('/household');
      await page.getByRole('link', { name: link, exact: true }).click();
      await expect(page.getByTestId('temporary-surface-notice')).toHaveCount(0);
      await expect(page.locator('button, input, textarea, select').first()).toBeVisible();
    }
  });

  test('the AI coach is native and grounded on the V2 snapshot', async ({ page, request }) => {
    // M5.7. The surface this replaces hosted V1's WealthCoach, which grounds on retail
    // (`Account.userId`) data a V2 consumer does not have — so it narrated ₹0 to a family with
    // ₹20,00,000. The native surface reads the same snapshot as the dashboard.
    const consumer = await createAccount(request);
    await asReturningConsumer(page, request, consumer);
    await signIn(page, consumer, PASSWORD);

    await page.goto('/wealth-health');
    await page.getByLabel('Cash & savings (₹)').fill('900000');
    await page.getByLabel('Investments (₹)').fill('1100000');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel('Monthly income (₹)').fill('300000');
    await page.getByLabel('Monthly expenses (₹)').fill('150000');
    await page.getByRole('button', { name: 'See my score' }).click();
    await expect(page.getByRole('heading', { name: 'Your Wealth Health' })).toBeVisible();

    await page.goto('/household');
    await page.getByRole('link', { name: 'AI coach', exact: true }).click();
    await expect(page).toHaveURL(/\/household\/coach$/);

    // No longer a migration surface.
    await expect(page.getByTestId('temporary-surface-notice')).toHaveCount(0);

    // A real summary, and provenance stated rather than implied.
    await expect(page.getByTestId('cfo-headline')).toBeVisible();
    await expect(page.getByTestId('cfo-provenance')).toContainText(/snapshot/i);

    // Asking is premium. The paywall must appear WITHOUT destroying the free summary above it
    // — a consumer who cannot chat can still read where they stand.
    await page.getByLabel('Ask your Family CFO').fill('Can I afford to retire at 55?');
    await page.getByRole('button', { name: 'Ask' }).click();
    await expect(page.getByText(/Premium feature/i)).toBeVisible();
    await expect(page.getByTestId('cfo-headline')).toBeVisible();
  });

  test('family is native, and adding a date of birth unlocks retirement', async ({
    page,
    request,
  }) => {
    // The headline outcome of M5.8 PR 1. Before it, no consumer in the product could see a
    // retirement projection: V1's family form never captured a date of birth and onboarding does
    // not set one, so the section reported "no member age" for everybody.
    const consumer = await createAccount(request);
    await asReturningConsumer(page, request, consumer);
    await signIn(page, consumer, PASSWORD);

    // Give the household figures, so retirement has something to project from.
    await page.goto('/wealth-health');
    await page.getByLabel('Cash & savings (₹)').fill('900000');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel('Monthly income (₹)').fill('300000');
    await page.getByLabel('Monthly expenses (₹)').fill('75000');
    await page.getByRole('button', { name: 'See my score' }).click();
    await expect(page.getByRole('heading', { name: 'Your Wealth Health' })).toBeVisible();

    // Retirement cannot be projected yet — the reason is shown, not a fabricated number.
    await page.goto('/household');
    await expect(page.getByText(/No member age available/i)).toBeVisible();

    // The native surface: no hosted-V1 notice, and the date-of-birth field V1 never had.
    await page.goto('/household/family');
    await expect(page.getByTestId('temporary-surface-notice')).toHaveCount(0);
    await expect(page.getByTestId('dob-missing-notice')).toBeVisible();

    await page.getByLabel('Name').fill('Meera Bhuyan');
    await page.getByLabel('Date of birth').fill('1985-04-02');
    await page.getByRole('button', { name: 'Add to my family' }).click();
    await expect(page.getByTestId('member-list')).toContainText('Meera Bhuyan');

    // Recapture so the snapshot carries the new member, then the panel appears.
    await page.goto('/wealth-health');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'See my score' }).click();
    await expect(page.getByRole('heading', { name: 'Your Wealth Health' })).toBeVisible();
    await page.getByRole('button', { name: 'Go to my dashboard' }).click();

    await expect(page.getByText(/No member age available/i)).toHaveCount(0);
    await expect(page.getByText('Monthly SIP needed')).toBeVisible();
  });

  test('V1 family still works on the dashboard — the safety net is untouched', async ({
    page,
    request,
  }) => {
    // PR 1 replaces the V2 surface only. V1's Family component still writes FamilyMember and
    // still renders on /dashboard, which stays the recoverable path until Module 10.
    const consumer = await createAccount(request);
    await asReturningConsumer(page, request, consumer);
    await signIn(page, consumer, PASSWORD);

    await page.goto('/dashboard');
    await expect(page.locator('button, input').first()).toBeVisible();
    await expect(page.getByText(/Application error/i)).toHaveCount(0);
  });

  test('goals are native, and the dashboard draws its charts', async ({ page, request }) => {
    // M5.8 PR 2. Goals move to the household, and the charts V1 had are drawn from layer data.
    const consumer = await createAccount(request);
    await asReturningConsumer(page, request, consumer);
    await signIn(page, consumer, PASSWORD);

    await page.goto('/wealth-health');
    await page.getByLabel('Cash & savings (₹)').fill('900000');
    await page.getByLabel('Investments (₹)').fill('1100000');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel('Monthly income (₹)').fill('300000');
    await page.getByLabel('Monthly expenses (₹)').fill('75000');
    await page.getByRole('button', { name: 'See my score' }).click();
    await expect(page.getByRole('heading', { name: 'Your Wealth Health' })).toBeVisible();

    // Native goals: no hosted-V1 notice.
    await page.goto('/household/goals');
    await expect(page.getByTestId('temporary-surface-notice')).toHaveCount(0);
    await page.getByLabel('What is it for').fill('New home');
    await page.getByLabel('Amount needed (₹)').fill('5000000');
    await page.getByLabel('Saved so far (₹)').fill('500000');
    await page.getByLabel('When you need it').fill('2030-06-01');
    await page.getByRole('button', { name: 'Add this goal' }).click();
    await expect(page.getByTestId('goal-list')).toContainText('New home');

    // The allocation chart draws from the layer's own percentages.
    await page.goto('/household');
    await expect(page.getByTestId('allocation-chart')).toBeVisible();
  });

  test('the dashboard trend appears only with a history, and captures nothing', async ({
    page,
    request,
  }) => {
    // Two properties at once. A single capture is not a trend, and drawing one would imply a
    // history the family does not have. And /household must stay read-only: V1's chart carries a
    // "Capture snapshot" button, which is exactly why only its drawing was reused here.
    const consumer = await createAccount(request);
    await asReturningConsumer(page, request, consumer);
    await signIn(page, consumer, PASSWORD);

    const runCheck = async () => {
      await page.goto('/wealth-health');
      await page.getByLabel('Cash & savings (₹)').fill('900000');
      await page.getByRole('button', { name: 'Continue' }).click();
      await page.getByRole('button', { name: 'Continue' }).click();
      await page.getByLabel('Monthly income (₹)').fill('300000');
      await page.getByLabel('Monthly expenses (₹)').fill('75000');
      await page.getByRole('button', { name: 'See my score' }).click();
      await expect(page.getByRole('heading', { name: 'Your Wealth Health' })).toBeVisible();
    };

    await runCheck();
    await page.goto('/household');
    // Wait for the timeline to have RESOLVED before asserting the chart is absent. Without this
    // the assertion passes while the fetch is still in flight — it did, against a build that
    // drew a trend from one capture, which is the exact defect this test is here to catch.
    await expect(page.getByTestId('trend-region')).toHaveCount(1);
    await expect(page.getByTestId('networth-trend')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Capture snapshot' })).toHaveCount(0);

    await runCheck();
    await page.goto('/household');
    await expect(page.getByTestId('networth-trend')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Capture snapshot' })).toHaveCount(0);
  });

  test('protection is native, and recording cover changes what the dashboard says', async ({
    page,
    request,
  }) => {
    // M5.9, end to end in a browser. Before this, a consumer could fill in the protection form
    // and change NO figure anywhere: it wrote the retail `Profile`, and the intelligence
    // controller never passed `assumptions`, so the panel's `coverTracked` was always false.
    const consumer = await createAccount(request);
    await asReturningConsumer(page, request, consumer);
    await signIn(page, consumer, PASSWORD);

    // A snapshot first, so the dashboard has something to render around the panel.
    await page.goto('/wealth-health');
    await page.getByLabel('Cash & savings (₹)').fill('900000');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel('Monthly income (₹)').fill('300000');
    await page.getByLabel('Monthly expenses (₹)').fill('75000');
    await page.getByRole('button', { name: 'See my score' }).click();
    await expect(page.getByRole('heading', { name: 'Your Wealth Health' })).toBeVisible();

    // Nothing recorded: the dashboard says so rather than showing a gap it cannot justify.
    await page.goto('/household');
    await expect(page.getByTestId('protection-panel')).toHaveCount(0);
    // The layer's own reason, rendered by Panel like any other unavailable section.
    await expect(page.getByText(/No insurance details recorded yet/i)).toBeVisible();

    // The native surface — no hosted-V1 notice, and it asks per person.
    await page.goto('/household/protection');
    await expect(page.getByTestId('temporary-surface-notice')).toHaveCount(0);
    await expect(page.getByTestId('protection-incomplete')).toBeVisible();

    const save = page.locator('[data-testid^="save-"]').first();
    const memberId = (await save.getAttribute('data-testid'))!.replace('save-', '');
    await page.getByTestId(`health-${memberId}`).selectOption('yes');
    await page.getByTestId(`term-${memberId}`).selectOption('yes');
    await page.getByLabel('Life cover amount (₹)').fill('60000000');
    await page.getByTestId(`save-${memberId}`).click();
    await expect(page.getByTestId('protection-summary')).toBeVisible();

    // The figure moved: the panel now renders, with no re-capture of the snapshot needed —
    // protection is a module-owned assumption, not a kernel position.
    await page.goto('/household');
    await expect(page.getByTestId('protection-panel')).toBeVisible();
  });

  test('Plans and Admin survived the move off the V1 dashboard', async ({ page, request }) => {
    // Both were linked ONLY from /dashboard. Without these links the routes still work by
    // URL but nobody can navigate to them — the silent kind of loss.
    const consumer = await createAccount(request);
    await asReturningConsumer(page, request, consumer);
    await signIn(page, consumer, PASSWORD);

    await page.getByRole('button', { name: 'Plans' }).click();
    await expect(page).toHaveURL(/\/billing$/);
  });

  test('an admin sees the Admin link on the V2 dashboard', async ({ page, request }) => {
    // Provision the admin's OWN household rather than assuming the seed left one: the
    // seeded admin's firm has no household, so /household would forward them into consumer
    // onboarding and the page under test would never render. This file's rule is that each
    // journey provisions the shape it needs instead of depending on database history.
    const login = await request.post(`${API_URL}/auth/login`, {
      data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    const { accessToken } = await login.json();
    const provisioned = await request.post(`${API_URL}/onboarding/household`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      data: {},
    });
    expect(provisioned.ok()).toBeTruthy();

    await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.goto('/household');
    await expect(page.getByRole('button', { name: 'Admin' })).toBeVisible();
  });
});

test.describe('dark mode is readable', () => {
  /**
   * A defect that shipped in M5.5/M5.6 and was invisible to every test: the V2 consumer
   * pages were unreadable in dark mode.
   *
   * `ThemeProvider` supplies context only — it renders no element. The class that adopts
   * the tokens is `.ds-root`, and `DashboardLayout` was the ONLY thing applying it, which
   * is why the Advisor Workspace themed correctly and the consumer pages did not. Dark mode
   * flipped the tokens, so every design-system component resolved `text-foreground` to
   * near-white, while the page background stayed `bg-slate-50`. Measured on /household:
   * heading rgb(241,245,249) on rgb(248,250,252) — a contrast ratio of about 1.04:1.
   *
   * It was reachable by default: with no stored preference, an OS set to dark resolves to
   * dark. So this asserts CONTRAST, not that a class is present — the property that matters
   * is that a user can read the page.
   */
  const CONSUMER_SURFACES = ['/household', '/wealth-health', '/household/goals', '/household/protection'];

  for (const path of CONSUMER_SURFACES) {
    test(`${path} has readable contrast in dark mode`, async ({ page, request }) => {
      const consumer = await createAccount(request);
      await page.addInitScript(() => localStorage.setItem('lcos-theme', 'dark'));
      await asReturningConsumer(page, request, consumer);
      await signIn(page, consumer, PASSWORD);
      await page.goto(path);
      await page.waitForSelector('h1');

      const contrast = await page.evaluate(() => {
        const cs = (el: Element) => getComputedStyle(el);
        const h1 = document.querySelector('h1')!;
        const rgb = (v: string) => (v.match(/\d+/g) ?? []).slice(0, 3).map(Number);
        // Relative luminance per WCAG.
        const lum = (c: number[]) => {
          const f = (v: number) => {
            const s = (v ?? 0) / 255;
            return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
          };
          return 0.2126 * f(c[0] ?? 0) + 0.7152 * f(c[1] ?? 0) + 0.0722 * f(c[2] ?? 0);
        };
        // The background actually painted behind the heading, not `body`.
        let el: Element | null = h1;
        let bg = 'rgb(255,255,255)';
        while (el) {
          const b = cs(el).backgroundColor;
          if (b && b !== 'rgba(0, 0, 0, 0)' && b !== 'transparent') { bg = b; break; }
          el = el.parentElement;
        }
        const l1 = lum(rgb(cs(h1).color));
        const l2 = lum(rgb(bg));
        const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
        return { dark: document.documentElement.classList.contains('dark'), ratio };
      });

      expect(contrast.dark).toBe(true);
      // WCAG AA for large text is 3:1. The broken state measured ~1.04:1.
      expect(contrast.ratio).toBeGreaterThan(3);
    });
  }
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

    // A brand-new account belongs to no firm, so it is a consumer.
    await page.waitForURL(/\/(household|onboarding)$/);
    await expect(page.getByText(/No firm yet/i)).toHaveCount(0);
  });
});
