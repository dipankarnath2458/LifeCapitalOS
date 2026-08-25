'use client';
/**
 * Wealth Health Check — the consumer's first real output from the platform.
 *
 * Design and rationale: `docs/M5_5_WEALTH_HEALTH_CHECK_ARCHITECTURE.md`.
 *
 * The result screen renders exactly what the API returns — overall, band, and each
 * category's score, reason and suggestion. **No financial figure is computed here.** The
 * kernel composes the snapshot and `@lcos/core` scores it; the browser collects and
 * displays. That is the kernel governance rule, and it is also what makes every number on
 * screen reproducible from an immutable snapshot.
 */
import { useEffect, useState } from 'react';
import { getAccessToken } from '@/lib/session';
import {
  loadCurrentFigures,
  runWealthHealthCheck,
  type HealthScoreResult,
} from '@/lib/wealthHealth';
import {
  Badge,
  Button,
  Card,
  CardContent,
  ErrorState,
  LabeledInput,
  Heading,
  Spinner,
  Text,
} from '@/ui';
import { ThemedPage } from '@/components/ThemedPage';
import { HouseholdUnavailable } from '@/components/HouseholdUnavailable';
import type { UnavailableReason } from '@/lib/household';
const STEPS = ['What you own', 'What you owe', 'Money in, money out'] as const;
const TOTAL = STEPS.length;
/** Bands come from the scoring model; this maps them to the design system's tones only. */
function toneFor(band: string): 'success' | 'warning' | 'danger' | 'neutral' {
  const b = band.toLowerCase();
  if (b.includes('excellent') || b.includes('strong') || b.includes('good')) return 'success';
  if (b.includes('fair') || b.includes('moderate')) return 'warning';
  if (b.includes('weak') || b.includes('poor') || b.includes('critical')) return 'danger';
  return 'neutral';
}
export default function WealthHealthPage() {
  const [token, setToken] = useState<string | null>(null);
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  /**
   * True until the prefill attempt settles.
   *
   * The form must not be typeable before then. The prefill setters run when the request
   * resolves, so anything typed in the meantime is silently overwritten — and for a family
   * with no figures yet the prefilled value is an empty string, so their input simply
   * vanishes. Two browser tests caught exactly that by typing faster than the network.
   */
  const [hydrating, setHydrating] = useState(true);
  /**
   * Gap 7. Set when we could not READ what the family already has, and to why. The form must
   * not be offered in that state: its blank fields would be written over real figures on submit.
   * `null` means the prefill succeeded (or they genuinely have nothing), not that it failed.
   */
  const [prefillFailed, setPrefillFailed] = useState<UnavailableReason | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<HealthScoreResult | null>(null);
  const [cash, setCash] = useState('');
  const [investments, setInvestments] = useState('');
  const [property, setProperty] = useState('');
  const [loanOutstanding, setLoanOutstanding] = useState('');
  const [loanMonthlyPayment, setLoanMonthlyPayment] = useState('');
  const [loanRatePct, setLoanRatePct] = useState('');
  const [monthlyIncome, setMonthlyIncome] = useState('');
  const [monthlyExpenses, setMonthlyExpenses] = useState('');
  useEffect(() => {
    const t = getAccessToken();
    if (!t) {
      window.location.href = '/login';
      return;
    }
    setToken(t);
    // Prefill from what the household already holds, so this reads as "update my figures"
    // rather than "tell us everything again". A blank field then means "I have none of
    // this" — something the user decided — instead of an empty box they never filled.
    //
    // A family with no figures yet is the common case and still gets an empty form. A family
    // whose figures we could not READ is not the same thing, and no longer shares that screen:
    // see the `prefillFailed` branch below.
    loadCurrentFigures(t)
      .then((res) => {
        // Gap 7, and the most dangerous instance of it. A failed prefill used to be
        // indistinguishable from "you have nothing recorded", so the form opened blank and a
        // submission wrote those blanks over figures the family already had. An unknown state
        // must not be offered as an editable zero — say so and let them retry.
        if (res.kind === 'unavailable') {
          setPrefillFailed(res.reason);
          return;
        }
        if (res.kind === 'none') return;
        const figures = res.figures;
        const put = (n: number) => (n > 0 ? String(n) : '');
        setCash(put(figures.cash));
        setInvestments(put(figures.investments));
        setProperty(put(figures.property));
        setLoanOutstanding(put(figures.loanOutstanding));
        setLoanMonthlyPayment(put(figures.loanMonthlyPayment));
        setLoanRatePct(put(figures.loanRatePct));
        setMonthlyIncome(put(figures.monthlyIncome));
        setMonthlyExpenses(put(figures.monthlyExpenses));
      })
      .catch(() => {
        /* keep the empty form */
      })
      .finally(() => setHydrating(false));
  }, []);
  const num = (v: string) => parseFloat(v) || 0;
  async function submit() {
    if (!token) return;
    setBusy(true);
    setErr(null);
    try {
      const score = await runWealthHealthCheck(token, {
        cash: num(cash),
        investments: num(investments),
        property: num(property),
        loanOutstanding: num(loanOutstanding),
        loanMonthlyPayment: num(loanMonthlyPayment),
        loanRatePct: num(loanRatePct),
        monthlyIncome: num(monthlyIncome),
        monthlyExpenses: num(monthlyExpenses),
      });
      setResult(score);
    } catch {
      // Deliberately does not advance: a user must not be shown a result screen when the
      // figures behind it may not have been saved.
      setErr('We could not complete your check. Your details are safe — please try again.');
    } finally {
      setBusy(false);
    }
  }
  if (result) {
    return (
      <ThemedPage>
        <main className="mx-auto max-w-2xl px-6 py-12">
          <Heading level={1} className="mb-1 text-2xl">
            Your Wealth Health
          </Heading>
          <Text muted className="mb-6 block text-sm">
            Based on the figures you just entered, scored against your family&apos;s complete
            financial position.
          </Text>
          <Card className="mb-6">
            <CardContent className="flex items-center justify-between gap-6 py-8">
              <div>
                <p className="text-5xl font-bold text-foreground" data-testid="overall-score">
                  {result.overall}
                  <span className="text-2xl text-subtle">/100</span>
                </p>
                <Badge tone={toneFor(result.band)} className="mt-2">
                  {result.band}
                </Badge>
              </div>
              <Text muted className="max-w-xs text-sm">
                Each area below is scored on its own and weighted into this total.
              </Text>
            </CardContent>
          </Card>
          <div className="space-y-3">
            {result.categories?.map((c) => (
              <Card key={c.key}>
                <CardContent className="py-4">
                  <div className="mb-1 flex items-baseline justify-between gap-4">
                    <Heading level={3} className="text-base">
                      {c.label}
                    </Heading>
                    <span className="shrink-0 text-sm font-semibold text-foreground">
                      {c.score}/100
                      <span className="ml-1 font-normal text-subtle">({c.weight}%)</span>
                    </span>
                  </div>
                  {/* Straight from the scoring model — the UI never writes its own explanation. */}
                  <Text muted className="block text-sm">
                    {c.reason}
                  </Text>
                  <Text className="mt-1 block text-sm">{c.suggestion}</Text>
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="mt-8 flex gap-3">
            {/* The Household Dashboard (M5.6) is where this score lives from now on. It
                reads the same snapshot this check just captured, so the number here and
                the number there cannot disagree. */}
            <Button onClick={() => (window.location.href = '/household')}>
              Go to my dashboard
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setResult(null);
                setStep(1);
              }}
            >
              Run it again
            </Button>
          </div>
        </main>
      </ThemedPage>
    );
  }
  if (prefillFailed) {
    return (
      <HouseholdUnavailable
        subject="the figures you already have"
        reason={prefillFailed ?? undefined}
        onRetry={() => window.location.reload()}
      />
    );
  }

  if (hydrating) {
    return (
      <ThemedPage>
        <main className="mx-auto max-w-lg px-6 py-12">
          <Heading level={1} className="mb-1 text-2xl">
            Wealth Health Check
          </Heading>
          <Text muted className="mb-6 block text-sm">
            Loading your figures…
          </Text>
          <Spinner />
        </main>
      </ThemedPage>
    );
  }
  return (
    <ThemedPage>
      <main className="mx-auto max-w-lg px-6 py-12">
        <Heading level={1} className="mb-1 text-2xl">
          Wealth Health Check
        </Heading>
        <Text muted className="mb-4 block text-sm">
          Step {step} of {TOTAL} · {STEPS[step - 1]}
        </Text>
        <div
          className="mb-6 h-1.5 w-full overflow-hidden rounded bg-muted"
          role="progressbar"
          aria-valuenow={step}
          aria-valuemin={1}
          aria-valuemax={TOTAL}
          aria-label="Wealth Health Check progress"
        >
          <div
            className="h-full bg-brand transition-all"
            style={{ width: `${(step / TOTAL) * 100}%` }}
          />
        </div>
        {err && <ErrorState title="Something went wrong" description={err} className="mb-4" />}
        <Card>
          <CardContent className="space-y-4">
            {step === 1 && (
              <>
                <Heading level={2} className="text-base">
                  What you own
                </Heading>
                <Text muted className="block text-sm">
                  Rough figures are fine — you can refine them later.
                </Text>
                <LabeledInput
                  label="Cash & savings (₹)"
                  hint="Bank balances and anything you can reach quickly."
                  type="number"
                  value={cash}
                  onChange={(e) => setCash(e.target.value)}
                />
                <LabeledInput
                  label="Investments (₹)"
                  hint="Mutual funds, stocks, EPF, PPF."
                  type="number"
                  value={investments}
                  onChange={(e) => setInvestments(e.target.value)}
                />
                <LabeledInput
                  label="Property (₹)"
                  hint="Current market value, if you own any."
                  type="number"
                  value={property}
                  onChange={(e) => setProperty(e.target.value)}
                />
                <Button onClick={() => setStep(2)} className="w-full">
                  Continue
                </Button>
              </>
            )}
            {step === 2 && (
              <>
                <Heading level={2} className="text-base">
                  What you owe
                </Heading>
                <Text muted className="block text-sm">
                  Leave these blank if you have no loans.
                </Text>
                <LabeledInput
                  label="Outstanding loan balance (₹)"
                  type="number"
                  value={loanOutstanding}
                  onChange={(e) => setLoanOutstanding(e.target.value)}
                />
                <LabeledInput
                  label="Monthly payment (₹)"
                  type="number"
                  value={loanMonthlyPayment}
                  onChange={(e) => setLoanMonthlyPayment(e.target.value)}
                />
                <LabeledInput
                  label="Interest rate (% a year)"
                  type="number"
                  value={loanRatePct}
                  onChange={(e) => setLoanRatePct(e.target.value)}
                />
                <div className="flex gap-3">
                  <Button variant="ghost" onClick={() => setStep(1)}>
                    Back
                  </Button>
                  <Button onClick={() => setStep(3)} className="flex-1">
                    Continue
                  </Button>
                </div>
              </>
            )}
            {step === 3 && (
              <>
                <Heading level={2} className="text-base">
                  Money in, money out
                </Heading>
                <Text muted className="block text-sm">
                  A typical month. This is what tells us how much you actually save.
                </Text>
                <LabeledInput
                  label="Monthly income (₹)"
                  hint="Take-home, after tax."
                  type="number"
                  value={monthlyIncome}
                  onChange={(e) => setMonthlyIncome(e.target.value)}
                />
                <LabeledInput
                  label="Monthly expenses (₹)"
                  hint="Everything you spend in a typical month."
                  type="number"
                  value={monthlyExpenses}
                  onChange={(e) => setMonthlyExpenses(e.target.value)}
                />
                <div className="flex gap-3">
                  <Button variant="ghost" onClick={() => setStep(2)} disabled={busy}>
                    Back
                  </Button>
                  <Button onClick={() => void submit()} disabled={busy} className="flex-1">
                    {busy ? (
                      <>
                        <Spinner className="mr-2 h-4 w-4" /> Working it out…
                      </>
                    ) : (
                      'See my score'
                    )}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </main>
    </ThemedPage>
  );
}
