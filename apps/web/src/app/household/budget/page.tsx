'use client';

/**
 * Your monthly budget — the M2-4 budget engine reaches the consumer (M5.13).
 *
 * Design: `docs/M5_13_WHATIF_AND_BUDGET_ARCHITECTURE.md`.
 *
 * The engine has existed since M2-4 and, until now, only an advisor could reach it. This closes
 * the budget half of Gap 5.
 *
 * **This page performs no financial arithmetic.** Every remaining balance, utilisation and
 * over-budget flag is one `evaluateBudget` returned through the API. The only computation is
 * rupees ↔ minor units.
 *
 * ## The honesty this page is built around
 *
 * Actual spend is aggregated live from the cashflow ledger, and for a consumer that ledger is
 * currently written by the Wealth Health Check as a single `living` line for the month. So a
 * family's spending is all there, but as one category. A budget page that quietly compared
 * envelopes against categories with no spend would report almost everyone as comfortably under
 * budget while their money went somewhere else entirely.
 *
 * So `uncategorized` — spend the ledger holds that no envelope covers — is shown as a first-class
 * part of the answer rather than a footnote, and the page tells the family where their recorded
 * spending comes from. Under-budget is only ever claimed about money we can actually see.
 *
 * Composed entirely from the frozen design system.
 */

import { useCallback, useEffect, useState } from 'react';
import { getAccessToken } from '@/lib/session';
import { resolveHouseholdId } from '@/lib/household';
import {
  currentMonth,
  loadBudget,
  monthLabel,
  rupeesToMinor,
  saveBudget,
  SUGGESTED_CATEGORIES,
  type BudgetMonth,
} from '@/lib/householdBudget';
import { formatMoney } from '@/lib/intelligence';
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  ErrorState,
  Heading,
  Input,
  LabeledInput,
  LoadingState,
  Select,
  Text,
} from '@/ui';
import { ThemedPage } from '@/components/ThemedPage';

/** An envelope as the family is editing it, before it becomes minor units. */
interface DraftLine {
  category: string;
  rupees: string;
}

const money = (m: number) => formatMoney(m);

/** `0.42` → `42%`. A presentation of a ratio the engine already computed, not a calculation. */
const asPercent = (ratio: number) => `${Math.round(ratio * 100)}%`;

export default function BudgetPage() {
  const [token, setToken] = useState<string | null>(null);
  const [householdId, setHouseholdId] = useState<string | null>(null);
  const [data, setData] = useState<BudgetMonth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);

  const [lines, setLines] = useState<DraftLine[]>([]);
  const [totalRupees, setTotalRupees] = useState('');
  const month = currentMonth();

  const load = useCallback(async (t: string, id: string) => {
    try {
      const res = await loadBudget(t, id);
      setData(res);
      setError(null);
    } catch {
      setError('load');
    }
  }, []);

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

  /** Open the editor seeded from what is stored, so editing never starts from a blank slate. */
  function beginEdit() {
    if (!data) return;
    setLines(
      data.lines.length > 0
        ? data.lines.map((l) => ({ category: l.category, rupees: String(l.limitMinor / 100) }))
        : // Nothing set yet: offer the category their spending is already recorded under, so the
          // first budget they save compares against real money rather than an empty envelope.
          [{ category: data.uncategorized[0]?.category ?? 'living', rupees: '' }],
    );
    setTotalRupees(data.totalBudgetMinor === null ? '' : String(data.totalBudgetMinor / 100));
    setEditing(true);
  }

  async function save() {
    if (!token || !householdId || busy) return;
    setBusy(true);
    setError(null);
    try {
      await saveBudget(token, householdId, {
        periodMonth: month,
        // Deliberately sent when the field reads '0' as well: a cap of zero is a real answer.
        // Left out entirely when blank, which the API stores as "no overall cap set".
        ...(totalRupees.trim() !== '' ? { totalAmountMinor: rupeesToMinor(totalRupees) } : {}),
        lines: lines
          .filter((l) => l.category.trim() !== '')
          .map((l) => ({ category: l.category.trim(), amountMinor: rupeesToMinor(l.rupees) })),
      });
      setEditing(false);
      await load(token, householdId);
    } catch {
      setError('save');
    } finally {
      setBusy(false);
    }
  }

  if (!token || (data === null && error === null)) {
    return (
      <ThemedPage>
        <LoadingState label="Loading your budget…" />
      </ThemedPage>
    );
  }

  if (error === 'needs-onboarding') {
    return (
      <ThemedPage>
        <main className="mx-auto max-w-3xl px-6 py-10">
          <EmptyState
            title="Let's set up your household first"
            description="Your budget belongs to your household, so we need that before anything else."
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
              Your monthly budget
            </Heading>
            <Text muted className="mt-1 block text-sm">
              {data ? monthLabel(data.periodMonth) : monthLabel(month)} — what you planned, and what
              you have actually spent.
            </Text>
          </div>
          <Button variant="ghost" size="sm" onClick={() => (window.location.href = '/household')}>
            Back to dashboard
          </Button>
        </div>

        {error === 'load' && <ErrorState description="We could not load your budget just now." />}
        {error === 'save' && (
          <ErrorState description="We could not save that. Please try again." />
        )}

        {data && !data.exists && !editing && (
          <EmptyState
            title="You have not set a budget for this month"
            description="Set what you plan to spend and we will show you how the month is going against it. We will not guess a budget for you."
            action={{ label: 'Set a budget', onClick: beginEdit }}
          />
        )}

        {/* WHAT THE MONTH LOOKS LIKE */}
        {data && data.exists && !editing && (
          <>
            <Card className="mb-4">
              <CardContent>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <Text muted className="block text-xs">
                      Spent so far
                    </Text>
                    <Text className="text-2xl font-semibold" data-testid="budget-spent">
                      {money(data.totalSpentMinor)}
                    </Text>
                  </div>
                  {data.totalBudgetMinor === null ? (
                    // Not zero, and not unlimited: they simply never set an overall cap.
                    <div>
                      <Text muted className="block text-xs">
                        Overall cap
                      </Text>
                      <Text muted className="block text-sm" data-testid="budget-no-cap">
                        You have not set one
                      </Text>
                    </div>
                  ) : (
                    <div>
                      <Text muted className="block text-xs">
                        Of an overall cap of
                      </Text>
                      <Text className="text-2xl font-semibold">{money(data.totalBudgetMinor)}</Text>
                      <Badge tone={data.overTotal ? 'danger' : 'success'}>
                        {data.overTotal
                          ? `Over by ${money(-(data.totalRemainingMinor ?? 0))}`
                          : `${money(data.totalRemainingMinor ?? 0)} left`}
                      </Badge>
                    </div>
                  )}
                  <Button variant="ghost" size="sm" onClick={beginEdit} data-testid="budget-edit">
                    Change my budget
                  </Button>
                </div>
              </CardContent>
            </Card>

            {data.lines.length > 0 && (
              <Card className="mb-4">
                <CardContent>
                  <Heading level={2} className="mb-3 text-base">
                    By category
                  </Heading>
                  <div className="space-y-3" data-testid="budget-lines">
                    {data.lines.map((l) => (
                      <div key={l.category} className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <Text className="font-medium capitalize">{l.category}</Text>
                          <Text muted className="mt-1 block text-xs">
                            {money(l.spentMinor)} of {money(l.limitMinor)} · {asPercent(l.utilization)}
                          </Text>
                        </div>
                        <Badge tone={l.overBudget ? 'danger' : 'success'}>
                          {l.overBudget
                            ? `Over by ${money(-l.remainingMinor)}`
                            : `${money(l.remainingMinor)} left`}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* The part that keeps this page honest. Spend we can see that no envelope covers is
                reported as such, rather than leaving a family "under budget" while their money
                went somewhere they never budgeted for. */}
            {data.uncategorized.length > 0 && (
              <Card className="mb-4">
                <CardContent>
                  <Heading level={2} className="mb-2 text-base">
                    Spending outside your budget
                  </Heading>
                  <Text muted className="mb-3 block text-xs">
                    This is money you have spent this month that none of your categories above
                    covers. It still counts.
                  </Text>
                  <div className="space-y-2" data-testid="budget-uncategorized">
                    {data.uncategorized.map((u) => (
                      <div key={u.category} className="flex items-center justify-between gap-2">
                        <Text className="font-medium capitalize">{u.category}</Text>
                        <Text className="font-medium">{money(u.spentMinor)}</Text>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}

        {/* SETTING IT */}
        {editing && (
          <Card className="mb-4">
            <CardContent>
              <Heading level={2} className="mb-3 text-base">
                What do you plan to spend?
              </Heading>

              <div className="sm:max-w-xs">
                <LabeledInput
                  label="Overall cap for the month (₹, optional)"
                  type="number"
                  value={totalRupees}
                  onChange={(e) => setTotalRupees(e.target.value)}
                  data-testid="budget-total"
                />
              </div>

              <Heading level={3} className="mb-2 mt-5 text-sm">
                Category by category
              </Heading>
              <div className="space-y-3" data-testid="budget-draft-lines">
                {lines.map((l, i) => (
                  <div key={i} className="flex flex-wrap items-end gap-3">
                    <div className="min-w-[10rem] flex-1">
                      <Text muted className="mb-1 block text-xs">
                        Category
                      </Text>
                      <Select
                        value={SUGGESTED_CATEGORIES.includes(l.category) ? l.category : 'other'}
                        onChange={(e) => {
                          const v = e.target.value;
                          setLines((ls) => ls.map((x, j) => (j === i ? { ...x, category: v } : x)));
                        }}
                        data-testid={`budget-category-${i}`}
                      >
                        {SUGGESTED_CATEGORIES.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div className="min-w-[8rem] flex-1">
                      <Text muted className="mb-1 block text-xs">
                        Planned (₹)
                      </Text>
                      <Input
                        type="number"
                        value={l.rupees}
                        onChange={(e) => {
                          const v = e.target.value;
                          setLines((ls) => ls.map((x, j) => (j === i ? { ...x, rupees: v } : x)));
                        }}
                        data-testid={`budget-amount-${i}`}
                      />
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                      data-testid={`budget-remove-${i}`}
                    >
                      Remove
                    </Button>
                  </div>
                ))}
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setLines((ls) => [...ls, { category: 'other', rupees: '' }])}
                  data-testid="budget-add-line"
                >
                  Add a category
                </Button>
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                <Button onClick={save} disabled={busy} data-testid="budget-save">
                  {busy ? 'Saving…' : 'Save my budget'}
                </Button>
                <Button variant="ghost" onClick={() => setEditing(false)} disabled={busy}>
                  Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Where the "actual" figures come from — stated plainly, because a family who does not
            know this cannot tell a real under-spend from an unrecorded one. */}
        {data && (
          <Card>
            <CardContent>
              <Text muted className="block text-xs" data-testid="budget-provenance">
                What you have spent comes from the figures in your Wealth Health Check, which
                records your month&apos;s spending as a single total. Categories you have budgeted
                for will only show spending against them once your spending is recorded under those
                categories.
              </Text>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => (window.location.href = '/wealth-health')}
                >
                  Update my figures
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => (window.location.href = '/household/what-if')}
                >
                  What if I spent less?
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </main>
    </ThemedPage>
  );
}
