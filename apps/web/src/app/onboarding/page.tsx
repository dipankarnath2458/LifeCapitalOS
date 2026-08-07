'use client';

/**
 * Consumer onboarding.
 *
 * ## What changed and why
 *
 * The previous version wrote a profile, an account and a goal — all on the retail
 * (`userId`) path — and never created a household. A consumer who completed every step
 * still had no `Household`, and `FinancialSnapshot` / `FinancialHealthScore` are
 * household-only, so they could never get a Wealth Health Check, a health score, or AI
 * insights. Onboarding looked complete and left the account unable to use the product.
 *
 * Step 1 now provisions the household before anything else, because it is the container
 * the rest of the product needs — not because the user has to think about it. See
 * `docs/architecture/M5-5_CONSUMER_ACTIVATION.md`.
 *
 * The word "firm" never appears here. Provisioning creates one internally; that is a
 * tenancy detail and a consumer must never be shown it.
 */

import { useEffect, useState } from 'react';
import { apiPost, apiPut } from '@/lib/api';
import { getAccessToken } from '@/lib/session';
import { ensureHousehold } from '@/lib/household';
import { resolvePostLoginDestination } from '@/lib/postLoginDestination';
import {
  Button,
  Card,
  CardContent,
  Field,
  Input,
  Select,
  ErrorState,
  Heading,
  Text,
  ThemeProvider,
  ThemeScript,
} from '@/ui';

const RISK = ['conservative', 'moderate', 'aggressive'] as const;
type Risk = (typeof RISK)[number];

const STEPS = ['Your family', 'About you', 'First account', 'Your first goal'] as const;
const TOTAL = STEPS.length;

export default function OnboardingPage() {
  const [token, setToken] = useState<string | null>(null);
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Step 1 — the household
  const [familyName, setFamilyName] = useState('');
  // Step 2 — profile basics
  const [fullName, setFullName] = useState('');
  const [dob, setDob] = useState('');
  const [income, setIncome] = useState('');
  const [expenses, setExpenses] = useState('');
  const [risk, setRisk] = useState<Risk>('moderate');
  // Step 3 — first account
  const [acctName, setAcctName] = useState('Savings account');
  const [acctBalance, setAcctBalance] = useState('');
  // Step 4 — first goal
  const [goalName, setGoalName] = useState('Retirement');
  const [goalTarget, setGoalTarget] = useState('');
  const [goalYears, setGoalYears] = useState('20');

  useEffect(() => {
    const t = getAccessToken();
    if (!t) {
      window.location.href = '/login';
      return;
    }
    setToken(t);
  }, []);

  const toMinor = (v: string) => Math.round((parseFloat(v) || 0) * 100);

  /** Runs a step, keeping the user on it when it fails rather than advancing past a loss. */
  async function run(work: () => Promise<void>, message: string): Promise<void> {
    if (!token) return;
    setBusy(true);
    setErr(null);
    try {
      await work();
    } catch {
      setErr(message);
    } finally {
      setBusy(false);
    }
  }

  async function createHousehold() {
    await run(async () => {
      // Idempotent server-side, so a double-click or a retry after a dropped response
      // cannot produce a second household.
      await ensureHousehold(token!, familyName.trim() ? { familyName: familyName.trim() } : {});
      setStep(2);
    }, 'We could not set up your household. Please try again.');
  }

  async function saveProfile() {
    await run(async () => {
      await apiPut(
        '/profile',
        {
          ...(fullName ? { fullName } : {}),
          ...(dob ? { dateOfBirth: dob } : {}),
          baseCurrency: 'INR',
          annualIncomeMinor: toMinor(income),
          monthlyExpensesMinor: toMinor(expenses),
          riskTolerance: risk,
        },
        token!,
      );
      setStep(3);
    }, 'Could not save your profile. Please try again.');
  }

  async function saveAccount() {
    await run(async () => {
      if (parseFloat(acctBalance) > 0) {
        await apiPost(
          '/accounts',
          {
            name: acctName,
            type: 'bank',
            assetClass: 'cash',
            currency: 'INR',
            balanceMinor: toMinor(acctBalance),
            isLiability: false,
          },
          token!,
        );
      }
      setStep(4);
    }, 'Could not add the account. Please try again.');
  }

  async function finish() {
    await run(async () => {
      if (parseFloat(goalTarget) > 0) {
        const targetDate = new Date();
        targetDate.setFullYear(targetDate.getFullYear() + (parseInt(goalYears, 10) || 1));
        await apiPost(
          '/goals',
          {
            name: goalName,
            type: 'retirement',
            currency: 'INR',
            targetAmountMinor: toMinor(goalTarget),
            currentAmountMinor: 0,
            targetDate: targetDate.toISOString(),
            expectedAnnualReturnPct: 11,
          },
          token!,
        );
      }
      await leave();
    }, 'Could not save your goal. You can add it later from your dashboard.');
  }

  /**
   * Leaves onboarding for wherever this user belongs.
   *
   * The household is provisioned in step 1, so skipping from any later step still leaves a
   * usable account — which is the point of letting people skip at all.
   */
  async function leave(): Promise<void> {
    localStorage.setItem('lcos_onboarded', '1');
    window.location.href = token ? await resolvePostLoginDestination(token) : '/dashboard';
  }

  /**
   * Skipping from step 1 provisions the household first. Without it the user would land on
   * a dashboard that cannot compute anything for them — a worse outcome than the small
   * wait. It is best-effort: a failure here must not trap anyone in onboarding.
   */
  async function skip(): Promise<void> {
    setBusy(true);
    if (token) await ensureHousehold(token, {}).catch(() => undefined);
    await leave();
  }

  return (
    <ThemeProvider>
      <ThemeScript />
      <main className="mx-auto max-w-lg px-6 py-12">
        <div className="mb-2 flex items-start justify-between gap-4">
          <Heading level={1} className="text-2xl">
            Welcome — let&apos;s set you up
          </Heading>
          <Button variant="ghost" size="sm" onClick={() => void skip()} disabled={busy}>
            Skip for now
          </Button>
        </div>
        <Text muted className="mb-4 block text-sm">
          Step {step} of {TOTAL} · {STEPS[step - 1]}
        </Text>

        <div
          className="mb-6 h-1.5 w-full overflow-hidden rounded bg-muted"
          role="progressbar"
          aria-valuenow={step}
          aria-valuemin={1}
          aria-valuemax={TOTAL}
          aria-label="Onboarding progress"
        >
          <div className="h-full bg-brand transition-all" style={{ width: `${(step / TOTAL) * 100}%` }} />
        </div>

        {err && <ErrorState title="Something went wrong" description={err} className="mb-4" />}

        <Card>
          <CardContent className="space-y-4">
            {step === 1 && (
              <>
                <Heading level={2} className="text-base">
                  Who are we planning for?
                </Heading>
                <Text muted className="block text-sm">
                  Your finances are organised around your family, so everything you add — accounts,
                  goals, and later your Wealth Health Check — stays in one place.
                </Text>
                <Field label="Family name" hint="You can change this later.">
                  <Input
                    value={familyName}
                    onChange={(e) => setFamilyName(e.target.value)}
                    placeholder="The Sharmas"
                    maxLength={120}
                  />
                </Field>
                <Button onClick={() => void createHousehold()} disabled={busy} className="w-full">
                  {busy ? 'Setting up…' : 'Continue'}
                </Button>
              </>
            )}

            {step === 2 && (
              <>
                <Heading level={2} className="text-base">
                  About you
                </Heading>
                <Field label="Full name">
                  <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
                </Field>
                <Field label="Date of birth" hint="Used for age-based scoring.">
                  <Input type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
                </Field>
                <Field label="Annual income (₹)">
                  <Input type="number" value={income} onChange={(e) => setIncome(e.target.value)} />
                </Field>
                <Field label="Monthly expenses (₹)">
                  <Input type="number" value={expenses} onChange={(e) => setExpenses(e.target.value)} />
                </Field>
                <Field label="Risk tolerance">
                  <Select value={risk} onChange={(e) => setRisk(e.target.value as Risk)}>
                    {RISK.map((r) => (
                      <option key={r} value={r}>
                        {r.charAt(0).toUpperCase() + r.slice(1)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Button onClick={() => void saveProfile()} disabled={busy} className="w-full">
                  {busy ? 'Saving…' : 'Continue'}
                </Button>
              </>
            )}

            {step === 3 && (
              <>
                <Heading level={2} className="text-base">
                  Add your first account
                </Heading>
                <Text muted className="block text-sm">
                  Start your balance sheet with a bank or savings balance.
                </Text>
                <Field label="Account name">
                  <Input value={acctName} onChange={(e) => setAcctName(e.target.value)} />
                </Field>
                <Field label="Current balance (₹)">
                  <Input
                    type="number"
                    value={acctBalance}
                    onChange={(e) => setAcctBalance(e.target.value)}
                  />
                </Field>
                <Button onClick={() => void saveAccount()} disabled={busy} className="w-full">
                  {busy ? 'Saving…' : 'Continue'}
                </Button>
              </>
            )}

            {step === 4 && (
              <>
                <Heading level={2} className="text-base">
                  Set one goal
                </Heading>
                <Text muted className="block text-sm">
                  We&apos;ll show the monthly SIP it needs.
                </Text>
                <Field label="Goal name">
                  <Input value={goalName} onChange={(e) => setGoalName(e.target.value)} />
                </Field>
                <Field label="Target amount (₹)">
                  <Input
                    type="number"
                    value={goalTarget}
                    onChange={(e) => setGoalTarget(e.target.value)}
                  />
                </Field>
                <Field label="Years to goal">
                  <Input type="number" value={goalYears} onChange={(e) => setGoalYears(e.target.value)} />
                </Field>
                <Button onClick={() => void finish()} disabled={busy} className="w-full">
                  {busy ? 'Finishing…' : 'Go to my dashboard'}
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </main>
    </ThemeProvider>
  );
}
