'use client';

/**
 * What if… — the M3-3 simulation engine reaches the consumer (M5.13).
 *
 * Design: `docs/M5_13_WHATIF_AND_BUDGET_ARCHITECTURE.md`.
 *
 * The engine has existed since M3-3 and, until now, only an advisor could reach it. This page
 * closes Gap 5 for the score-shaped half of that gap: it turns "increase your savings" from a
 * recommendation a family reads into a change a family can try.
 *
 * **This page performs no financial arithmetic.** Every score, delta and band is one the engine
 * returned. The only computation is rupees → minor units on the way out.
 *
 * Three promises the layout is built around:
 *
 * 1. **Nothing is saved.** The engine is non-mutating and persists nothing; the page says so
 *    where a family can see it before they touch anything, not in a footnote afterwards.
 * 2. **The "before" is their real score.** It comes from the same model, with the same protection
 *    and retirement facts, as the number on their dashboard — asserted by
 *    `apps/api/test/simulation-score-agreement.e2e-spec.ts`.
 * 3. **A change that helps nothing says so.** A zero delta is reported as "no change", never
 *    dressed up, and a change that lowers the score is shown lowering it.
 *
 * Composed entirely from the frozen design system.
 */

import { useCallback, useEffect, useState } from 'react';
import { getAccessToken } from '@/lib/session';
import { resolveHousehold, type UnavailableReason } from '@/lib/household';
import {
  BAND_LABEL,
  CATEGORY_LABEL,
  CONSUMER_SCENARIOS,
  rupeesToMinor,
  runSimulation,
  type ConsumerScenario,
  type SimulationResponse,
  type SimulationResult,
} from '@/lib/householdSimulation';
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  ErrorState,
  Heading,
  LabeledInput,
  LoadingState,
  Text,
  type BadgeTone,
} from '@/ui';
import { ThemedPage } from '@/components/ThemedPage';
import { HouseholdUnavailable } from '@/components/HouseholdUnavailable';

const BAND_TONE: Record<string, BadgeTone> = {
  at_risk: 'danger',
  needs_attention: 'warning',
  fair: 'neutral',
  good: 'success',
  excellent: 'success',
};

const band = (b: string) => BAND_LABEL[b] ?? b.replace(/_/g, ' ');
const categoryName = (key: string, fallback: string) => CATEGORY_LABEL[key] ?? fallback;

/** A signed score movement, worded rather than merely coloured. */
function Delta({ value }: { value: number }) {
  if (value === 0) {
    return (
      <Text muted className="text-sm">
        No change to your score
      </Text>
    );
  }
  const better = value > 0;
  return (
    <Badge tone={better ? 'success' : 'danger'}>
      {better ? '+' : ''}
      {value} {better ? 'better' : 'worse'}
    </Badge>
  );
}

export default function WhatIfPage() {
  const [token, setToken] = useState<string | null>(null);
  const [householdId, setHouseholdId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Gap 7: why resolution failed, so the message can be specific rather than generic. */
  const [unavailableReason, setUnavailableReason] = useState<UnavailableReason | undefined>();
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  /** Which changes the family has picked, and how much of each. Rupees as typed. */
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [amounts, setAmounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(CONSUMER_SCENARIOS.map((s) => [s.type, String(s.defaultRupees)])),
  );
  const [outcome, setOutcome] = useState<SimulationResult | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);

  useEffect(() => {
    const t = getAccessToken();
    if (!t) {
      window.location.href = '/login';
      return;
    }
    setToken(t);
    void resolveHousehold(t).then((r) => {
      // Gap 7: three outcomes, not two. A throttled lookup must not tell a family with a
      // household that they have none — see `docs/GAP_7_HOUSEHOLD_RESOLUTION_ARCHITECTURE.md`.
      if (r.kind === 'unavailable') {
        setUnavailableReason(r.reason);
        setError('unavailable');
        setReady(true);
        return;
      }
      if (r.kind === 'none') {
        setError('needs-onboarding');
        setReady(true);
        return;
      }
      setHouseholdId(r.householdId);
      setReady(true);
    });
  }, []);

  const selected: ConsumerScenario[] = CONSUMER_SCENARIOS.filter((s) => picked[s.type]).map((s) => ({
    type: s.type,
    label: s.label,
    params: { [s.paramKey]: rupeesToMinor(amounts[s.type] ?? '0') },
  }));

  const run = useCallback(async () => {
    if (!token || !householdId || busy || selected.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res: SimulationResponse = await runSimulation(token, householdId, selected);
      if (res.available) {
        setOutcome(res.result);
        setUnavailable(null);
      } else {
        // The layer's own reason, rather than an invented number. Most often: no snapshot yet.
        setOutcome(null);
        setUnavailable(res.reason);
      }
    } catch {
      setError('run');
    } finally {
      setBusy(false);
    }
  }, [token, householdId, busy, selected]);

  function toggle(type: string) {
    setPicked((p) => ({ ...p, [type]: !p[type] }));
    // A previous result describes a different question; keep it only while the question stands.
    setOutcome(null);
  }

  if (!ready) {
    return (
      <ThemedPage>
        <LoadingState label="Loading…" />
      </ThemedPage>
    );
  }

  if (error === 'unavailable') {
    return <HouseholdUnavailable subject="your figures" reason={unavailableReason} />;
  }

  if (error === 'needs-onboarding') {
    return (
      <ThemedPage>
        <main className="mx-auto max-w-3xl px-6 py-10">
          <EmptyState
            title="Let's set up your household first"
            description="What-if works from your household's figures, so we need those before anything else."
            action={{ label: 'Get started', onClick: () => (window.location.href = '/onboarding') }}
          />
        </main>
      </ThemedPage>
    );
  }

  return (
    <ThemedPage>
      <main className="mx-auto max-w-3xl px-6 py-10">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <Heading level={1} className="text-2xl">
              What if…
            </Heading>
            <Text muted className="mt-1 block text-sm">
              Try a change and see what it would do to your Wealth Health Score.
            </Text>
          </div>
          <Button variant="ghost" size="sm" onClick={() => (window.location.href = '/household')}>
            Back to dashboard
          </Button>
        </div>

        {/* The promise, before they touch anything — not as a footnote afterwards. */}
        <Card className="mb-4">
          <CardContent>
            <Text muted className="block text-xs" data-testid="whatif-non-mutating">
              Nothing on this page changes your plan or your figures. We work out what your score
              would look like and then forget it.
            </Text>
          </CardContent>
        </Card>

        {error === 'run' && (
          <ErrorState description="We could not work that out just now. Please try again." />
        )}

        {unavailable && (
          <EmptyState
            title="Run your Wealth Health Check first"
            description="What-if compares against your latest figures, so we need those before we can show you anything."
            action={{
              label: 'Run the check',
              onClick: () => (window.location.href = '/wealth-health'),
            }}
          />
        )}

        {/* PICK THE CHANGES */}
        <Card className="mb-4">
          <CardContent>
            <Heading level={2} className="mb-3 text-base">
              What would you like to try?
            </Heading>
            <div className="space-y-4" data-testid="whatif-scenarios">
              {CONSUMER_SCENARIOS.map((s) => (
                <div key={s.type} className="border-b border-[var(--color-border)] pb-4 last:border-0 last:pb-0">
                  <label className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={!!picked[s.type]}
                      onChange={() => toggle(s.type)}
                      data-testid={`whatif-pick-${s.type}`}
                    />
                    <span>
                      <Text className="font-medium">{s.label}</Text>
                      <Text muted className="mt-1 block text-xs">
                        {s.help}
                      </Text>
                    </span>
                  </label>
                  {picked[s.type] && (
                    <div className="mt-3 pl-7 sm:max-w-xs">
                      <LabeledInput
                        label={s.amountLabel}
                        type="number"
                        value={amounts[s.type] ?? ''}
                        onChange={(e) => {
                          setAmounts((a) => ({ ...a, [s.type]: e.target.value }));
                          setOutcome(null);
                        }}
                        data-testid={`whatif-amount-${s.type}`}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-5 flex items-center gap-3">
              <Button onClick={run} disabled={busy || selected.length === 0} data-testid="whatif-run">
                {busy ? 'Working it out…' : 'Show me'}
              </Button>
              {selected.length === 0 && (
                <Text muted className="text-xs">
                  Pick at least one change.
                </Text>
              )}
            </div>
          </CardContent>
        </Card>

        {/* THE ANSWER */}
        {outcome && (
          <>
            <Card className="mb-4">
              <CardContent>
                <Heading level={2} className="mb-3 text-base">
                  What would happen
                </Heading>
                <div className="flex flex-wrap items-center gap-4" data-testid="whatif-summary">
                  <div>
                    <Text muted className="block text-xs">
                      Your score today
                    </Text>
                    <Text className="text-2xl font-semibold" data-testid="whatif-before">
                      {outcome.summary.overallBefore}
                    </Text>
                    <Badge tone={BAND_TONE[outcome.summary.bandBefore] ?? 'neutral'}>
                      {band(outcome.summary.bandBefore)}
                    </Badge>
                  </div>
                  <Text muted aria-hidden className="text-xl">
                    →
                  </Text>
                  <div>
                    <Text muted className="block text-xs">
                      If you made these changes
                    </Text>
                    <Text className="text-2xl font-semibold" data-testid="whatif-after">
                      {outcome.summary.overallAfter}
                    </Text>
                    <Badge tone={BAND_TONE[outcome.summary.bandAfter] ?? 'neutral'}>
                      {band(outcome.summary.bandAfter)}
                    </Badge>
                  </div>
                  <div className="ml-auto">
                    <Delta value={outcome.summary.overallDelta} />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Which single change carries the most, when the family picked several. */}
            {outcome.bestSingleAction && selected.length > 1 && (
              <Card className="mb-4">
                <CardContent>
                  <Heading level={2} className="mb-2 text-base">
                    The one that helps most
                  </Heading>
                  <Text className="font-medium" data-testid="whatif-best">
                    {outcome.bestSingleAction.scenario.label ?? outcome.bestSingleAction.scenario.type}
                  </Text>
                  <Text muted className="mt-1 block text-xs">
                    On its own, it moves your score by{' '}
                    {outcome.bestSingleAction.overallDelta >= 0 ? '+' : ''}
                    {outcome.bestSingleAction.overallDelta}.
                  </Text>
                </CardContent>
              </Card>
            )}

            <Card className="mb-4">
              <CardContent>
                <Heading level={2} className="mb-3 text-base">
                  Where it would show
                </Heading>
                <div className="space-y-3" data-testid="whatif-categories">
                  {outcome.categoryImpacts.map((c) => (
                    <div key={c.key} className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <Text className="font-medium">{categoryName(c.key, c.label)}</Text>
                        <Text muted className="mt-1 block text-xs">
                          {c.before} → {c.after}
                        </Text>
                      </div>
                      <Delta value={c.delta} />
                    </div>
                  ))}
                </div>
                <Text muted className="mt-4 block text-xs">
                  Parts of your score we have not been told about are left out here, exactly as they
                  are on your dashboard.
                </Text>
              </CardContent>
            </Card>

            <Card>
              <CardContent>
                <Text muted className="block text-xs" data-testid="whatif-provenance">
                  Worked out from your latest Wealth Health Check using scoring model{' '}
                  {outcome.metadata.scoreModelVersion} and simulation engine{' '}
                  {outcome.metadata.simulationEngineVersion}. Same figures, same answer, every time.
                </Text>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => (window.location.href = '/household/budget')}
                  >
                    Set a monthly budget
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => (window.location.href = '/household/retirement')}
                  >
                    What if I retire later?
                  </Button>
                </div>
              </CardContent>
            </Card>
          </>
        )}

        {/* A family with nothing owed cannot try repaying it; say so rather than showing a
            change that would do nothing. The engine caps each transform at what exists, so an
            impossible amount silently becomes a zero delta — this explains that. */}
        {outcome && outcome.summary.overallDelta === 0 && (
          <Card className="mt-4">
            <CardContent>
              <Text muted className="block text-sm" data-testid="whatif-no-effect">
                That would not move your score. Some changes have no effect if there is nothing to
                apply them to — repaying borrowing you do not have, for example, or moving more into
                cash than you hold.
              </Text>
            </CardContent>
          </Card>
        )}
      </main>
    </ThemedPage>
  );
}
