'use client';

import { useEffect, useState } from 'react';
import { apiPost, apiPut } from '@/lib/api';

const RISK = ['conservative', 'moderate', 'aggressive'] as const;

export default function OnboardingPage() {
  const [token, setToken] = useState<string | null>(null);
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Step 1 — profile basics
  const [fullName, setFullName] = useState('');
  const [dob, setDob] = useState('');
  const [income, setIncome] = useState('');
  const [expenses, setExpenses] = useState('');
  const [risk, setRisk] = useState<(typeof RISK)[number]>('moderate');
  // Step 2 — first account
  const [acctName, setAcctName] = useState('Savings account');
  const [acctBalance, setAcctBalance] = useState('');
  // Step 3 — first goal
  const [goalName, setGoalName] = useState('Retirement');
  const [goalTarget, setGoalTarget] = useState('');
  const [goalYears, setGoalYears] = useState('20');

  useEffect(() => {
    const t = typeof window !== 'undefined' ? localStorage.getItem('lcos_access') : null;
    if (!t) {
      window.location.href = '/login';
      return;
    }
    setToken(t);
  }, []);

  const toMinor = (v: string) => Math.round((parseFloat(v) || 0) * 100);

  async function saveProfile() {
    if (!token) return;
    setBusy(true);
    setErr(null);
    try {
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
        token,
      );
      setStep(2);
    } catch {
      setErr('Could not save your profile. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function saveAccount() {
    if (!token) return;
    setBusy(true);
    setErr(null);
    try {
      if (parseFloat(acctBalance) > 0) {
        await apiPost(
          '/accounts',
          { name: acctName, type: 'bank', assetClass: 'cash', currency: 'INR', balanceMinor: toMinor(acctBalance), isLiability: false },
          token,
        );
      }
      setStep(3);
    } catch {
      setErr('Could not add the account. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    if (!token) return;
    setBusy(true);
    setErr(null);
    try {
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
          token,
        );
      }
      localStorage.setItem('lcos_onboarded', '1');
      window.location.href = '/dashboard';
    } catch {
      setErr('Could not save your goal. You can add it later from the dashboard.');
    } finally {
      setBusy(false);
    }
  }

  function skip() {
    localStorage.setItem('lcos_onboarded', '1');
    window.location.href = '/dashboard';
  }

  return (
    <main className="mx-auto max-w-lg px-6 py-12">
      <div className="mb-2 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Welcome — let&apos;s set you up</h1>
        <button onClick={skip} className="text-sm text-slate-400 hover:text-slate-600">
          Skip for now
        </button>
      </div>
      <p className="mb-6 text-sm text-slate-500">Step {step} of 3</p>

      <div className="mb-6 h-1.5 w-full overflow-hidden rounded bg-slate-100">
        <div className="h-full bg-brand transition-all" style={{ width: `${(step / 3) * 100}%` }} />
      </div>

      {err && <div className="mb-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{err}</div>}

      <div className="rounded-2xl bg-white p-6 shadow">
        {step === 1 && (
          <div className="space-y-4">
            <h2 className="font-semibold">About you</h2>
            <Field label="Full name">
              <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </Field>
            <Field label="Date of birth (used for age-based scoring)">
              <input type="date" className="input" value={dob} onChange={(e) => setDob(e.target.value)} />
            </Field>
            <Field label="Annual income (₹)">
              <input type="number" className="input" value={income} onChange={(e) => setIncome(e.target.value)} />
            </Field>
            <Field label="Monthly expenses (₹)">
              <input type="number" className="input" value={expenses} onChange={(e) => setExpenses(e.target.value)} />
            </Field>
            <Field label="Risk tolerance">
              <select className="input" value={risk} onChange={(e) => setRisk(e.target.value as typeof risk)}>
                {RISK.map((r) => (
                  <option key={r} value={r}>
                    {r.charAt(0).toUpperCase() + r.slice(1)}
                  </option>
                ))}
              </select>
            </Field>
            <button onClick={saveProfile} disabled={busy} className="btn-primary w-full">
              {busy ? 'Saving…' : 'Continue'}
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <h2 className="font-semibold">Add your first account</h2>
            <p className="text-sm text-slate-500">Start your balance sheet with a bank or savings balance.</p>
            <Field label="Account name">
              <input className="input" value={acctName} onChange={(e) => setAcctName(e.target.value)} />
            </Field>
            <Field label="Current balance (₹)">
              <input type="number" className="input" value={acctBalance} onChange={(e) => setAcctBalance(e.target.value)} />
            </Field>
            <button onClick={saveAccount} disabled={busy} className="btn-primary w-full">
              {busy ? 'Saving…' : 'Continue'}
            </button>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <h2 className="font-semibold">Set one goal</h2>
            <p className="text-sm text-slate-500">We&apos;ll show the monthly SIP it needs.</p>
            <Field label="Goal name">
              <input className="input" value={goalName} onChange={(e) => setGoalName(e.target.value)} />
            </Field>
            <Field label="Target amount (₹)">
              <input type="number" className="input" value={goalTarget} onChange={(e) => setGoalTarget(e.target.value)} />
            </Field>
            <Field label="Years to goal">
              <input type="number" className="input" value={goalYears} onChange={(e) => setGoalYears(e.target.value)} />
            </Field>
            <button onClick={finish} disabled={busy} className="btn-primary w-full">
              {busy ? 'Finishing…' : 'Go to my dashboard'}
            </button>
          </div>
        )}
      </div>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm text-slate-600">{label}</span>
      {children}
    </label>
  );
}
