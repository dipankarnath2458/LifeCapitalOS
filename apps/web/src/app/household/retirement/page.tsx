'use client';

/**
 * Your retirement — the first Planning Experience (M5.10).
 *
 * Design: `docs/M5_10_RETIREMENT_PLANNING_ARCHITECTURE.md`.
 *
 * Follows the narrative the milestone asks for: where I am → where I want to go → what I may
 * need → am I on track → what should I do → what if.
 *
 * **This page performs no financial arithmetic.** Every figure is one the planning service
 * returned, including the status and the recommendations. V1's `RetirementCalculator` computes
 * in React from numbers a family types and persists nothing; it stays on `/dashboard` as the
 * safety net, and this replaces it as the experience that counts.
 *
 * Composed entirely from the frozen design system.
 */

import { useCallback, useEffect, useState } from 'react';
import { getAccessToken } from '@/lib/session';
import { resolveHouseholdId } from '@/lib/household';
import {
  loadRetirement,
  runWhatIf,
  saveRetirementPlan,
  STATUS_LABEL,
  type PlanInput,
  type RetirementOverview,
  type ScenarioOutcome,
  type ScenarioType,
} from '@/lib/householdRetirement';
import { formatMoney } from '@/lib/intelligence';
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
} from '@/ui';
import { ThemedPage } from '@/components/ThemedPage';

const money = (m: number) => formatMoney(m);
const rupeesToMinor = (v: string) => Math.round((parseFloat(v) || 0) * 100);

/** A figure with where it came from, so an assumption of ours never reads as a choice of theirs. */
function Sourced({ label, value, source }: { label: string; value: string; source: string }) {
  return (
    <div>
      <Text muted className="block text-xs">
        {label}
      </Text>
      <Text className="font-medium">{value}</Text>
      {source !== 'stated' && (
        <Text muted className="block text-xs">
          {source === 'default' ? 'standard assumption' : 'from your figures'}
        </Text>
      )}
    </div>
  );
}

const SCENARIOS: { type: ScenarioType; label: string; years?: number; amountMinor?: number }[] = [
  { type: 'retire_later', label: 'Retire 5 years later', years: 5 },
  { type: 'retire_earlier', label: 'Retire 5 years earlier', years: 5 },
  { type: 'increase_contribution', label: 'Save ₹10,000 more a month', amountMinor: 10_000_00 },
];

export default function RetirementPage() {
  const [token, setToken] = useState<string | null>(null);
  const [householdId, setHouseholdId] = useState<string | null>(null);
  const [data, setData] = useState<RetirementOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcomes, setOutcomes] = useState<ScenarioOutcome[] | null>(null);
  const [form, setForm] = useState({ age: '', lifeExpectancy: '', income: '', contribution: '' });
  /** Stops the prefill from overwriting what someone is typing — the M5.8 PR 2 lesson. */
  const [hydrated, setHydrated] = useState(false);

  const load = useCallback(
    async (t: string, id: string) => {
      try {
        const res = await loadRetirement(t, id);
        setData(res);
        setError(null);
        if (!hydrated && res.available) {
          const a = res.assumptions;
          setForm({
            age: String(a.retirementAge.value),
            lifeExpectancy: String(a.lifeExpectancy.value),
            income: String(a.desiredAnnualIncomeMinor.value / 100),
            contribution:
              a.monthlyContributionMinor === null
                ? ''
                : String(a.monthlyContributionMinor.value / 100),
          });
          setHydrated(true);
        }
      } catch {
        setError('load');
      }
    },
    [hydrated],
  );

  useEffect(() => {
    const t = getAccessToken();
    if (!t) {
      window.location.href = '/login';
      return;
    }
    setToken(t);
    void resolveHouseholdId(t).then((id) => {
      if (!id) {
        setError('needs-onboarding');
        return;
      }
      setHouseholdId(id);
      return load(t, id);
    });
  }, [load]);

  async function save() {
    if (!token || !householdId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const input: PlanInput = {
        ...(form.age ? { retirementAge: parseInt(form.age, 10) } : {}),
        ...(form.lifeExpectancy ? { lifeExpectancy: parseInt(form.lifeExpectancy, 10) } : {}),
        ...(form.income ? { desiredAnnualIncomeMinor: rupeesToMinor(form.income) } : {}),
        // Deliberately sent when the field is '0' as well as when it holds a number: stating
        // that you save nothing is a real answer, and must not be dropped as if unanswered.
        ...(form.contribution.trim() !== ''
          ? { monthlyContributionMinor: rupeesToMinor(form.contribution) }
          : {}),
      };
      await saveRetirementPlan(token, householdId, input);
      setOutcomes(null);
      await load(token, householdId);
    } catch {
      setError('save');
    } finally {
      setBusy(false);
    }
  }

  async function explore() {
    if (!token || !householdId || busy) return;
    setBusy(true);
    try {
      const res = await runWhatIf(token, householdId, SCENARIOS);
      setOutcomes(res.available ? res.outcomes : []);
    } catch {
      setError('save');
    } finally {
      setBusy(false);
    }
  }

  if (!token || (data === null && error === null)) {
    return (
      <ThemedPage>
        <LoadingState label="Loading your retirement plan…" />
      </ThemedPage>
    );
  }

  if (error === 'needs-onboarding') {
    return (
      <ThemedPage>
        <main className="mx-auto max-w-3xl px-6 py-10">
          <EmptyState
            title="Let's set up your household first"
            description="Your retirement plan belongs to your household, so we need that before anything else."
            action={{ label: 'Get started', onClick: () => (window.location.href = '/onboarding') }}
          />
        </main>
      </ThemedPage>
    );
  }

  const notReady = data && !data.available ? data.reason : null;
  const section = data?.available ? data.retirement : null;
  const r = section?.available ? section.data : null;
  const projection = r?.projection.available ? r.projection.data : null;

  return (
    <ThemedPage>
      <main className="mx-auto max-w-3xl px-6 py-10">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <Heading level={1} className="text-2xl">
              Your retirement
            </Heading>
            <Text muted className="mt-1 block text-sm">
              What you may need, where you are heading, and what would change it.
            </Text>
          </div>
          <Button variant="ghost" size="sm" onClick={() => (window.location.href = '/household')}>
            Back to dashboard
          </Button>
        </div>

        {error === 'load' && <ErrorState description="We could not load your plan just now." />}
        {error === 'save' && <ErrorState description="We could not save that. Please try again." />}

        {notReady && (
          <EmptyState
            title="Run your Wealth Health Check first"
            description="Your retirement projection is built from your latest figures, so we need those before we can plan."
            action={{
              label: 'Run the check',
              onClick: () => (window.location.href = '/wealth-health'),
            }}
          />
        )}

        {data?.available && (
          <>
            {/* WHERE I AM */}
            <Card className="mb-4">
              <CardContent>
                <Heading level={2} className="mb-3 text-base">
                  Where you are
                </Heading>
                {data.subject ? (
                  <Text muted className="mb-3 block text-xs" data-testid="retirement-subject">
                    Projected for your household&apos;s {data.subject.relation}, aged{' '}
                    {data.subject.ageYears}. One plan covers the household.
                  </Text>
                ) : (
                  <Text muted className="mb-3 block text-xs">
                    Add a date of birth on your family page so we can project ages.
                  </Text>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  <Sourced
                    label="Retirement savings today"
                    value={money(data.assumptions.currentCorpusMinor.value)}
                    source={data.assumptions.currentCorpusMinor.source}
                  />
                  <Sourced
                    label="Saving each month"
                    value={
                      data.assumptions.monthlyContributionMinor === null
                        ? 'Not told us yet'
                        : money(data.assumptions.monthlyContributionMinor.value)
                    }
                    source={data.assumptions.monthlyContributionMinor?.source ?? 'default'}
                  />
                </div>
                <Text muted className="mt-3 block text-xs">
                  Your home is deliberately not counted as retirement savings.
                </Text>
              </CardContent>
            </Card>

            {/* WHERE I WANT TO GO */}
            <Card className="mb-4">
              <CardContent>
                <Heading level={2} className="mb-3 text-base">
                  Where you want to go
                </Heading>
                <div className="grid gap-3 sm:grid-cols-2">
                  <LabeledInput
                    label="Retire at age"
                    type="number"
                    value={form.age}
                    onChange={(e) => setForm({ ...form, age: e.target.value })}
                  />
                  <LabeledInput
                    label="Plan until age"
                    type="number"
                    value={form.lifeExpectancy}
                    onChange={(e) => setForm({ ...form, lifeExpectancy: e.target.value })}
                  />
                  <LabeledInput
                    label="Yearly income you want (₹)"
                    type="number"
                    value={form.income}
                    onChange={(e) => setForm({ ...form, income: e.target.value })}
                  />
                  <LabeledInput
                    label="Saving for retirement each month (₹)"
                    type="number"
                    value={form.contribution}
                    onChange={(e) => setForm({ ...form, contribution: e.target.value })}
                  />
                </div>
                <div className="mt-4">
                  <Button onClick={save} disabled={busy} data-testid="save-plan">
                    Save my plan
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* WHAT I NEED + AM I ON TRACK */}
            {section && !section.available && (
              <Card className="mb-4">
                <CardContent>
                  <Heading level={2} className="mb-2 text-base">
                    What you may need
                  </Heading>
                  {/* The layer's own reason, rather than a blank card. Most often this is a
                      missing date of birth: without an age there is no horizon to project over,
                      and inventing one would be the fabrication this milestone avoids. */}
                  <Text muted className="block text-sm" data-testid="retirement-unavailable">
                    {section.reason}
                  </Text>
                  <div className="mt-3">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => (window.location.href = '/household/family')}
                    >
                      Add a date of birth
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {r && (
              <Card className="mb-4">
                <CardContent>
                  <Heading level={2} className="mb-3 text-base">
                    What you may need
                  </Heading>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Sourced
                      label={`Needed by age ${r.retirementAge}`}
                      value={money(r.requiredCorpusMinor)}
                      source="stated"
                    />
                    <Sourced
                      label={`Yearly income then, after inflation`}
                      value={money(r.inflatedAnnualIncomeMinor)}
                      source="stated"
                    />
                  </div>

                  <div className="mt-5">
                    <Heading level={3} className="mb-2 text-sm">
                      Are you on track?
                    </Heading>
                    {projection ? (
                      <div className="space-y-2" data-testid="retirement-projection">
                        <Badge
                          tone={
                            projection.status === 'on_track'
                              ? 'success'
                              : projection.status === 'watch'
                                ? 'warning'
                                : 'danger'
                          }
                        >
                          {STATUS_LABEL[projection.status]}
                        </Badge>
                        <Sourced
                          label="On course for"
                          value={money(projection.projectedCorpusAtRetirementMinor)}
                          source="stated"
                        />
                        <Sourced
                          label={
                            projection.surplusOrShortfallMinor >= 0 ? 'Surplus' : 'Shortfall'
                          }
                          value={money(Math.abs(projection.surplusOrShortfallMinor))}
                          source="stated"
                        />
                      </div>
                    ) : (
                      // Not zero, and not "on track" by omission: without a contribution we
                      // genuinely do not know where this family lands.
                      <Text muted className="block text-sm" data-testid="projection-unavailable">
                        {r.projection.available ? '' : r.projection.reason}
                      </Text>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* WHAT SHOULD I DO */}
            {data.recommendations.length > 0 && (
              <Card className="mb-4">
                <CardContent>
                  <Heading level={2} className="mb-3 text-base">
                    What you could do
                  </Heading>
                  <div className="space-y-3" data-testid="retirement-recommendations">
                    {data.recommendations.map((rec) => (
                      <div key={rec.key}>
                        <Text className="font-medium">{rec.title}</Text>
                        <Text muted className="mt-1 block text-xs">
                          {rec.rationale}
                        </Text>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* WHAT IF */}
            <Card>
              <CardContent>
                <Heading level={2} className="mb-3 text-base">
                  What if…
                </Heading>
                <Text muted className="mb-3 block text-xs">
                  Nothing here changes your plan — it only shows what would happen.
                </Text>
                <Button variant="ghost" size="sm" onClick={explore} disabled={busy} data-testid="run-whatif">
                  Explore these options
                </Button>
                {outcomes && outcomes.length > 0 && (
                  <div className="mt-4 space-y-3" data-testid="whatif-outcomes">
                    {outcomes.map((o, i) => (
                      <div key={o.type}>
                        <Text className="font-medium">{SCENARIOS[i]?.label ?? o.type}</Text>
                        <Text muted className="mt-1 block text-xs">
                          {o.deltaSurplusMinor >= 0 ? 'Better off by ' : 'Worse off by '}
                          {money(Math.abs(o.deltaSurplusMinor))} · {STATUS_LABEL[o.status]}
                        </Text>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </main>
    </ThemedPage>
  );
}
