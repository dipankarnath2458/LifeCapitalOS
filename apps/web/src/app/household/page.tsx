'use client';

/**
 * Household Dashboard (M5.6) — the canonical consumer of the V2 Financial Intelligence
 * Layer.
 *
 * Design: `docs/M5_6_HOUSEHOLD_DASHBOARD_ARCHITECTURE.md`.
 *
 * Three properties this page exists to hold:
 *
 *  1. **One snapshot.** Everything comes from a single `/intelligence/current` call, so no
 *     two panels can disagree about the same family.
 *  2. **No arithmetic.** Every figure is a field the engine returned; the page formats and
 *     nothing more. Business math never lives in the browser.
 *  3. **Absence is shown, not zeroed.** An unavailable section renders the engine's own
 *     reason. A protection gap of ₹0 would read as "fully covered", which is the opposite
 *     of "we don't know".
 *
 * The page is READ ONLY. It captures no snapshot and persists no score.
 */

import { useEffect, useState } from 'react';
import { apiGet } from '@/lib/api';
import { getAccessToken, signOut } from '@/lib/session';
import { isAdminRole } from '@/lib/admin';
import {
  formatMoney,
  loadDashboard,
  toneFor,
  type DashboardState,
  type HouseholdIntelligence,
  type ResolvedRetirementAssumptions,
  type Section,
} from '@/lib/intelligence';
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  ErrorState,
  Heading,
  LoadingState,
  Text,
} from '@/ui';
import { ThemedPage } from '@/components/ThemedPage';
import { AllocationDonutChart } from '@/components/charts/AllocationDonutChart';
import {
  formatTrendDate,
  NetWorthTrendChart,
  type TrendPoint,
} from '@/components/charts/NetWorthTrendChart';
import { loadTimeline } from '@/lib/householdGoals';

/**
 * Renders a section, or the engine's reason for it being unavailable.
 *
 * Every panel goes through here so that "unknown" can never be silently rendered as a
 * figure — the single most important rule on this page.
 */
function Panel<T>({
  title,
  section,
  children,
}: {
  title: string;
  section: Section<T>;
  children: (data: T) => React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="py-5">
        <Heading level={3} className="mb-2 text-base">
          {title}
        </Heading>
        {section.available ? (
          children(section.data)
        ) : (
          <Text muted className="block text-sm" data-testid="section-unavailable">
            {section.reason}
          </Text>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Names the figures in the retirement projection that are OURS, not the family's (M5.14, Gap 3).
 *
 * Three provenances, and only one of them warrants a caveat:
 *
 * - `stated`  — they told us. Nothing to say.
 * - `derived` — computed from figures they recorded. Also theirs; saying "standard assumptions"
 *               about their own corpus was the understating half of Gap 3.
 * - `default` — our documented convention, which they never chose. This is the only one worth
 *               a family's attention, and now it is named rather than implied.
 *
 * Renders nothing when every figure is theirs — silence is the correct output for a complete plan.
 */
function AssumedFrom({ assumptions }: { assumptions: ResolvedRetirementAssumptions }) {
  const LABELS: Record<string, string> = {
    retirementAge: 'the age you retire',
    yearsInRetirement: 'how long you plan for',
    inflationRatePct: 'inflation',
    preRetirementReturnPct: 'investment growth before retirement',
    postRetirementReturnPct: 'investment growth after',
    currentCorpusMinor: 'your retirement savings',
    desiredAnnualIncomeMinor: 'the income you want',
  };

  const ours = Object.entries(assumptions)
    .filter(([, f]) => f !== null && f.source === 'default')
    .map(([key]) => LABELS[key] ?? key);

  if (ours.length === 0) return null;

  const list =
    ours.length === 1
      ? ours[0]
      : `${ours.slice(0, -1).join(', ')} and ${ours[ours.length - 1]}`;

  return (
    <Text muted className="block text-xs" data-testid="retirement-assumed">
      We assumed {list}. Everything else comes from your own figures — set your plan to replace
      what we assumed.
    </Text>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-subtle">{label}</p>
      <p className="text-lg font-semibold text-foreground">{value}</p>
    </div>
  );
}

/**
 * The consumer shell: header, primary actions, and the preserved-capability nav.
 *
 * Rendered in EVERY state, not only when intelligence loads. A consumer who has onboarded
 * but not yet run their Wealth Health Check would otherwise land on a bare call-to-action
 * with no way to sign out, reach Plans or Admin, or reach Goals / Family / Protection /
 * the AI coach — capability lost silently, which is the exact failure this migration is
 * meant to avoid.
 */
function ConsumerShell({
  isAdmin,
  title,
  subtitle,
  children,
}: {
  isAdmin: boolean;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Heading level={1} className="text-2xl">
            {title}
          </Heading>
          {subtitle && (
            <Text muted className="mt-1 block text-sm">
              {subtitle}
            </Text>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" size="sm" onClick={() => (window.location.href = '/wealth-health')}>
            Update my figures
          </Button>
          {/* Plans and Admin were reachable ONLY from the V1 dashboard. Consumers no longer
              land there, so without these links /billing and /admin would still work by URL
              but be unreachable by navigation — a silent loss. */}
          <Button variant="ghost" size="sm" onClick={() => (window.location.href = '/billing')}>
            Plans
          </Button>
          {isAdmin && (
            <Button variant="ghost" size="sm" onClick={() => (window.location.href = '/admin')}>
              Admin
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </header>

      {/* The rest of the family's finances. Every one of these is a NATIVE V2 surface as of
          M5.9 — none is a hosted V1 component any more (AI coach M5.7, Family M5.8 PR 1, Goals
          PR 2, Protection M5.9). The V1 originals all still render on `/dashboard`, which stays
          the recoverable path until Module 10.

          Budget and What-if (M5.13) are different in kind from the rest: both engines have
          existed since M2-4 and M3-3 and had no consumer route at all — Gap 5 — so these two
          links are the whole of what the milestone gives a family. */}
      <nav aria-label="More of your finances" className="mb-6 flex flex-wrap gap-2">
        {[
          { href: '/household/goals', label: 'Goals' },
          { href: '/household/retirement', label: 'Retirement' },
          { href: '/household/budget', label: 'Budget' },
          { href: '/household/what-if', label: 'What if…' },
          { href: '/household/family', label: 'Family' },
          { href: '/household/protection', label: 'Protection' },
          { href: '/household/coach', label: 'AI coach' },
        ].map((l) => (
          <a
            key={l.href}
            href={l.href}
            className="rounded-lg border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted"
          >
            {l.label}
          </a>
        ))}
      </nav>

      {children}
    </main>
  );
}

export default function HouseholdDashboardPage() {
  const [state, setState] = useState<DashboardState | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  /**
   * Net-worth history, read from the kernel's own timeline. A separate call because it is
   * history rather than the current position — the single-snapshot rule governs the figures on
   * this page, and a trend is by definition many snapshots. A failure here leaves the trend
   * panel out; it must never take the dashboard down.
   */
  const [trend, setTrend] = useState<TrendPoint[] | null>(null);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      window.location.href = '/login';
      return;
    }
    // Role decides only whether the Admin link renders; the API enforces access itself.
    void apiGet<{ role?: string }>('/auth/me', token)
      .then((me) => setIsAdmin(isAdminRole(me.role)))
      .catch(() => setIsAdmin(false));

    void loadDashboard(token).then((s) => {
      // First-run: a consumer with no household goes to the guided flow. This redirect used
      // to live on the V1 dashboard and was the ONLY entry into onboarding in the product;
      // it moves here because consumers are no longer routed to /dashboard.
      if (s.kind === 'needs-onboarding') {
        window.location.href = '/onboarding';
        return;
      }
      setState(s);
      if (s.kind === 'error') return;

      // Chained rather than parallel, using the id `loadDashboard` already resolved. Firing it
      // alongside meant a second `/onboarding/status` for a value we were holding — enough,
      // with the rest of a page load, to earn a 429 from the rate limiter.
      //
      // Reads only. No capture button reaches this page: `/household` is read-only, and an
      // existing test asserts that viewing it captures no snapshot.
      void loadTimeline(token, s.householdId)
        .then((points) =>
          setTrend(
            points.map((p) => ({
              date: formatTrendDate(p.capturedAt),
              // Reconciled, matching the headline above. Both fields come from the timeline, so
              // this selects rather than calculates.
              net: (p.netWorthMinor - p.totalDebtMinor) / 100,
            })),
          ),
        )
        // The trend is secondary. A failure here leaves the panel out; it must never take the
        // dashboard down.
        .catch(() => setTrend([]));
    });
  }, []);

  if (!state) {
    return (
      <ThemedPage>
        <LoadingState label="Loading your financial picture…" />
      </ThemedPage>
    );
  }

  if (state.kind === 'error') {
    return (
      <ThemedPage>
        <ConsumerShell isAdmin={isAdmin} title="Your household">
          {/* Deliberately NOT the "run your check" screen: their data may exist and simply
              be unreachable, and inviting them to re-enter it would be misleading. */}
          <ErrorState
            title="We couldn't load your dashboard"
            description="Your data is safe. Please refresh in a moment."
            action={{ label: 'Try again', onClick: () => window.location.reload() }}
          />
        </ConsumerShell>
      </ThemedPage>
    );
  }

  if (state.kind === 'needs-check') {
    return (
      <ThemedPage>
        <ConsumerShell isAdmin={isAdmin} title="Your household">
          <EmptyState
            title="Let's build your financial picture"
            description="Answer a few questions about what you own, what you owe, and your monthly money. We'll do the rest."
            action={{
              label: 'Start my Wealth Health Check',
              onClick: () => (window.location.href = '/wealth-health'),
            }}
          />
        </ConsumerShell>
      </ThemedPage>
    );
  }

  if (state.kind === 'needs-onboarding') {
    // Unreachable in practice — the effect redirects before this state is ever stored.
    // Rendering a spinner rather than asserting keeps a redirect that is in flight from
    // flashing an error screen.
    return (
      <ThemedPage>
        <LoadingState label="Setting up your account…" />
      </ThemedPage>
    );
  }

  const i: HouseholdIntelligence = state.intelligence;
  const currency = i.meta.currency;
  const money = (minor: number) => formatMoney(minor, currency);

  return (
    <ThemedPage>
      <ConsumerShell
        isAdmin={isAdmin}
        title={i.household.name ?? 'Your household'}
        subtitle={i.executiveSummary.headline}
      >

        {/* Wealth Health — the headline number, straight from the engine. */}
        <div className="mb-4">
          <Panel title="Wealth Health" section={i.wealthHealth}>
            {(w) => (
              <div className="flex flex-wrap items-center gap-6">
                <div>
                  <p className="text-4xl font-bold text-foreground" data-testid="overall-score">
                    {w.overall}
                    <span className="text-xl text-subtle">/100</span>
                  </p>
                  <Badge className="mt-1">{w.band}</Badge>
                </div>
                <div className="grid flex-1 grid-cols-2 gap-3 sm:grid-cols-3">
                  {w.categories.map((c) => (
                    <Figure key={c.key} label={c.label} value={`${c.score}/100`} />
                  ))}
                </div>
              </div>
            )}
          </Panel>
        </div>

        {/* Net worth over time. Rendered only with at least two captures — a single point is
            not a trend, and drawing one would imply a history the family does not have yet.

            The wrapper appears as soon as the timeline RESOLVES, and stays empty until there
            are two points. It earns its place: without it, a test asserting the chart is absent
            passes while the fetch is still in flight, so "we correctly drew no trend" and "the
            page had not loaded yet" are indistinguishable. That is not hypothetical — the first
            version of this test passed against a build that drew a trend from a single
            capture. */}
        {trend !== null && (
          <div data-testid="trend-region">
            {trend.length >= 2 && (
              <Card className="mt-4" data-testid="networth-trend">
                <CardContent className="py-5">
                  <Heading level={3} className="mb-2 text-base">
                    Net worth over time
                  </Heading>
                  <NetWorthTrendChart points={trend} />
                </CardContent>
              </Card>
            )}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Panel title="Net worth" section={i.netWorth}>
            {(n) => (
              <div className="space-y-3">
                <p className="text-3xl font-bold text-foreground" data-testid="net-worth">
                  {money(n.netWorthMinor)}
                </p>
                {/*
                  Loans are shown as their own figure because the Wealth Health Check
                  writes every loan to the debt ledger and never as a liability account.
                  With only Assets and Liabilities on the panel, a family who entered a
                  ₹4,00,000 loan saw "Liabilities ₹0" and their loan nowhere at all.
                */}
                <div className="grid grid-cols-3 gap-3">
                  <Figure label="Assets" value={money(n.assetsMinor)} />
                  <Figure label="Liabilities" value={money(n.liabilitiesMinor)} />
                  <Figure label="Loans" value={money(n.totalDebtMinor)} />
                </div>
              </div>
            )}
          </Panel>

          <Panel title="Emergency fund" section={i.emergencyFund}>
            {(e) => (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <p className="text-3xl font-bold text-foreground">
                    {e.monthsCovered.toFixed(1)}
                    <span className="ml-1 text-base font-normal text-subtle">months</span>
                  </p>
                  <Badge tone={toneFor(e.status)}>target {e.targetMonths}m</Badge>
                </div>
                {e.shortfallMinor > 0 && (
                  <Figure label="Shortfall" value={money(e.shortfallMinor)} />
                )}
              </div>
            )}
          </Panel>

          <Panel title="Monthly cashflow" section={i.cashflow}>
            {(c) => (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <Figure label="Income" value={money(c.incomeMinor)} />
                  <Figure label="Expenses" value={money(c.expenseMinor)} />
                </div>
                <div className="flex items-center gap-3">
                  <Figure label="Saved" value={money(c.netMinor)} />
                  <Badge tone={toneFor(c.status)}>{Math.round(c.savingsRate * 100)}% saved</Badge>
                </div>
              </div>
            )}
          </Panel>

          <Panel title="How your money is spread" section={i.assetAllocation}>
            {(a) => (
              <div className="space-y-2">
                {/* The same chart `/dashboard` draws, fed percentages the engine already
                    computed. No allocation maths happens in the browser. */}
                {a.current.length > 0 && (
                  <div className="mb-4" data-testid="allocation-chart">
                    <AllocationDonutChart
                      slices={a.current.map((slice) => ({
                        name: slice.assetClass.replace(/_/g, ' '),
                        value: Math.round(slice.pct),
                      }))}
                    />
                  </div>
                )}
                {a.current.map((slice) => (
                  <div key={slice.assetClass} className="flex items-center justify-between gap-3">
                    <span className="text-sm capitalize text-foreground">
                      {slice.assetClass.replace(/_/g, ' ')}
                    </span>
                    <span className="text-sm text-subtle">
                      {Math.round(slice.pct)}% · {money(slice.baseValueMinor)}
                    </span>
                  </div>
                ))}
                {a.topConcentration && (
                  <Badge tone={toneFor(a.concentrationRisk)} className="mt-2">
                    {Math.round(a.topConcentration.pct)}% in{' '}
                    {a.topConcentration.assetClass.replace(/_/g, ' ')}
                  </Badge>
                )}
              </div>
            )}
          </Panel>

          <Panel title="Retirement" section={i.retirement}>
            {(r) => (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <p className="text-3xl font-bold text-foreground">{Math.round(r.readinessPct)}%</p>
                  <Badge tone={r.onTrack ? 'success' : 'warning'}>
                    {r.onTrack ? 'on track' : 'behind'}
                  </Badge>
                </div>
                <Figure label="Monthly SIP needed" value={money(r.monthlySipRequiredMinor)} />
                {/* Gap 3 (M5.14). This used to be one blanket sentence shown whenever the family
                    had no plan row — so a family who had stated their retirement age and target
                    income saw the identical message to one who had stated nothing, and figures
                    derived from their OWN recorded data were described as our assumptions.
                    Now it names only what is actually ours. */}
                <AssumedFrom assumptions={r.assumptions} />
              </div>
            )}
          </Panel>

          {/* The `coverTracked` guard that used to live here is gone. It existed because the
              layer returned `available: true` with a gap computed against a cover of zero, so
              this page had to know not to believe it. Since M5.9 the layer reports absence
              itself, and `Panel` renders its reason like every other section — one fewer place
              where a consumer has to remember that a figure might not mean what it says. */}
          <Panel title="Protection" section={i.insurance}>
            {(ins) => (
              <div className="space-y-3" data-testid="protection-panel">
                <Badge tone={toneFor(ins.status)}>{ins.adequate ? 'adequate' : 'gap'}</Badge>
                <Figure label="Recommended cover" value={money(ins.recommendedCoverMinor)} />
                {ins.protectionGapMinor > 0 && (
                  <Figure label="Shortfall" value={money(ins.protectionGapMinor)} />
                )}
              </div>
            )}
          </Panel>
        </div>

        {i.recommendedActions.length > 0 && (
          <section className="mt-8">
            <Heading level={2} className="mb-3 text-lg">
              What to do next
            </Heading>
            <div className="space-y-3">
              {i.recommendedActions.map((a) => (
                <Card key={`${a.priority}-${a.title}`}>
                  <CardContent className="py-4">
                    <div className="flex items-baseline justify-between gap-3">
                      <Heading level={3} className="text-base">
                        {a.title}
                      </Heading>
                      <Badge>{a.estimatedImpact} impact</Badge>
                    </div>
                    {/* The engine's rationale, verbatim — the UI never writes advice. */}
                    <Text muted className="mt-1 block text-sm">
                      {a.rationale}
                    </Text>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        )}

        {i.meta.dataCompleteness.missing.length > 0 && (
          <section className="mt-8">
            <Card>
              <CardContent className="py-4">
                <Heading level={3} className="text-base">
                  Make this more accurate
                </Heading>
                <Text muted className="mt-1 block text-sm">
                  We have {Math.round(i.meta.dataCompleteness.pct)}% of the picture. Still missing:{' '}
                  {i.meta.dataCompleteness.missing.join(', ')}.
                </Text>
              </CardContent>
            </Card>
          </section>
        )}

        {/* Provenance. Every number above traces to this snapshot and these engine
            versions — so any figure a user or advisor questions can be reproduced. */}
        <footer className="mt-10 border-t border-border pt-4">
          <Text muted className="block text-xs">
            Based on your snapshot {i.meta.snapshotId.slice(0, 8)} · engine {i.meta.engineVersion} ·
            scoring {i.meta.scoreModelVersion} · {new Date(i.meta.computedAt).toLocaleString('en-IN')}
          </Text>
        </footer>
      </ConsumerShell>
    </ThemedPage>
  );
}
