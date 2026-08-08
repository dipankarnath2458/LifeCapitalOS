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
  ThemeProvider,
  ThemeScript,
} from '@/ui';

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

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-subtle">{label}</p>
      <p className="text-lg font-semibold text-foreground">{value}</p>
    </div>
  );
}

export default function HouseholdDashboardPage() {
  const [state, setState] = useState<DashboardState | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

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
    });
  }, []);

  if (!state) {
    return (
      <ThemeProvider>
        <ThemeScript />
        <LoadingState label="Loading your financial picture…" />
      </ThemeProvider>
    );
  }

  if (state.kind === 'error') {
    return (
      <ThemeProvider>
        <ThemeScript />
        <main className="mx-auto max-w-lg px-6 py-16">
          {/* Deliberately NOT the "run your check" screen: their data may exist and simply
              be unreachable, and inviting them to re-enter it would be misleading. */}
          <ErrorState
            title="We couldn't load your dashboard"
            description="Your data is safe. Please refresh in a moment."
            action={{ label: 'Try again', onClick: () => window.location.reload() }}
          />
        </main>
      </ThemeProvider>
    );
  }

  if (state.kind === 'needs-check') {
    return (
      <ThemeProvider>
        <ThemeScript />
        <main className="mx-auto max-w-lg px-6 py-16">
          <EmptyState
            title="Let's build your financial picture"
            description="Answer a few questions about what you own, what you owe, and your monthly money. We'll do the rest."
            action={{
              label: 'Start my Wealth Health Check',
              onClick: () => (window.location.href = '/wealth-health'),
            }}
          />
        </main>
      </ThemeProvider>
    );
  }

  if (state.kind === 'needs-onboarding') {
    // Unreachable in practice — the effect redirects before this state is ever stored.
    // Rendering a spinner rather than asserting keeps a redirect that is in flight from
    // flashing an error screen.
    return (
      <ThemeProvider>
        <ThemeScript />
        <LoadingState label="Setting up your account…" />
      </ThemeProvider>
    );
  }

  const i: HouseholdIntelligence = state.intelligence;
  const currency = i.meta.currency;
  const money = (minor: number) => formatMoney(minor, currency);

  return (
    <ThemeProvider>
      <ThemeScript />
      <main className="mx-auto max-w-4xl px-6 py-10">
        <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <Heading level={1} className="text-2xl">
              {i.household.name ?? 'Your household'}
            </Heading>
            <Text muted className="mt-1 block text-sm">
              {i.executiveSummary.headline}
            </Text>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" size="sm" onClick={() => (window.location.href = '/wealth-health')}>
              Update my figures
            </Button>
            {/* Plans and Admin were reachable ONLY from the V1 dashboard. Consumers no
                longer land there, so without these links /billing and /admin would still
                work by URL but be unreachable by navigation — a silent loss. */}
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

        {/* Capabilities V2 has not rebuilt yet, hosted on temporary surfaces that reuse the
            preserved V1 components. Linked here so nothing is silently lost while V2 is
            primary. Each is replaced by the module named on its own page. */}
        <nav aria-label="More of your finances" className="mb-6 flex flex-wrap gap-2">
          {[
            { href: '/household/goals', label: 'Goals' },
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

        <div className="grid gap-4 sm:grid-cols-2">
          <Panel title="Net worth" section={i.netWorth}>
            {(n) => (
              <div className="space-y-3">
                <p className="text-3xl font-bold text-foreground" data-testid="net-worth">
                  {money(n.netWorthMinor)}
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <Figure label="Assets" value={money(n.assetsMinor)} />
                  <Figure label="Liabilities" value={money(n.liabilitiesMinor)} />
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
                {r.usingDefaultAssumptions && (
                  <Text muted className="block text-xs">
                    Based on standard assumptions — add your retirement plans to refine this.
                  </Text>
                )}
              </div>
            )}
          </Panel>

          <Panel title="Protection" section={i.insurance}>
            {(ins) =>
              ins.coverTracked ? (
                <div className="space-y-3">
                  <Badge tone={toneFor(ins.status)}>{ins.adequate ? 'adequate' : 'gap'}</Badge>
                  <Figure label="Recommended cover" value={money(ins.recommendedCoverMinor)} />
                  {ins.protectionGapMinor > 0 && (
                    <Figure label="Shortfall" value={money(ins.protectionGapMinor)} />
                  )}
                </div>
              ) : (
                // Not zero: an untracked cover is unknown, and rendering a ₹0 gap would
                // read as "fully covered".
                <Text muted className="block text-sm">
                  We don&apos;t have your insurance details yet, so protection isn&apos;t scored.
                </Text>
              )
            }
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
      </main>
    </ThemeProvider>
  );
}
