'use client';

import { useState } from 'react';
import { computeRetirement, formatMoney, money, type Money } from '@lcos/core';

/** Retirement Readiness calculator — runs client-side via the shared @lcos/core engine. */
export function RetirementCalculator() {
  const [form, setForm] = useState({
    currentAge: 32,
    retirementAge: 60,
    yearsInRetirement: 25,
    annualExpenses: 1200000,
    currentCorpus: 2000000,
    inflationRatePct: 6,
    preReturnPct: 11,
    postReturnPct: 7,
  });
  const [result, setResult] = useState<ReturnType<typeof computeRetirement> | null>(null);

  function run() {
    setResult(
      computeRetirement({
        currentAge: form.currentAge,
        retirementAge: form.retirementAge,
        yearsInRetirement: form.yearsInRetirement,
        currentAnnualExpensesMinor: form.annualExpenses * 100,
        currentCorpusMinor: form.currentCorpus * 100,
        inflationRatePct: form.inflationRatePct,
        preRetirementReturnPct: form.preReturnPct,
        postRetirementReturnPct: form.postReturnPct,
        currency: 'INR',
      }),
    );
  }

  const n = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: Number(e.target.value) });

  return (
    <div className="grid gap-8 md:grid-cols-2">
      <div className="rounded-2xl bg-white p-6 shadow">
        <h3 className="mb-4 text-lg font-semibold">Your retirement plan</h3>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Current age" value={form.currentAge} onChange={n('currentAge')} />
          <Field label="Retirement age" value={form.retirementAge} onChange={n('retirementAge')} />
          <Field label="Years in retirement" value={form.yearsInRetirement} onChange={n('yearsInRetirement')} />
          <Field label="Annual expenses (₹)" value={form.annualExpenses} onChange={n('annualExpenses')} />
          <Field label="Current corpus (₹)" value={form.currentCorpus} onChange={n('currentCorpus')} />
          <Field label="Inflation %" value={form.inflationRatePct} onChange={n('inflationRatePct')} />
          <Field label="Return before (%)" value={form.preReturnPct} onChange={n('preReturnPct')} />
          <Field label="Return after (%)" value={form.postReturnPct} onChange={n('postReturnPct')} />
        </div>
        <button
          onClick={run}
          className="mt-6 w-full rounded-xl bg-brand px-4 py-3 font-semibold text-white hover:bg-brand-dark"
        >
          Calculate
        </button>
      </div>

      <div className="rounded-2xl bg-white p-6 shadow">
        <h3 className="mb-4 text-lg font-semibold">Your retirement readiness</h3>
        {!result ? (
          <p className="text-slate-500">Enter your details and calculate the corpus you need.</p>
        ) : (
          <div className="space-y-4">
            <Stat label="Corpus needed at retirement" value={formatMoney(result.requiredCorpus)} highlight />
            <Stat label="Projected from current savings" value={formatMoney(result.projectedCorpusFromCurrent)} />
            <Stat
              label="Gap to close"
              value={formatMoney(result.corpusGap)}
              tone={result.onTrack ? 'good' : 'bad'}
            />
            <Stat label="Monthly SIP required" value={formatMoney(result.monthlySipRequired)} highlight />
            <p
              className={`rounded-lg p-3 text-sm ${
                result.onTrack ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
              }`}
            >
              {result.onTrack
                ? 'You are on track for the retirement you described. 🎉'
                : 'There is a gap — start the monthly SIP above to close it. Sign up to track progress.'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <label className="text-sm">
      <span className="mb-1 block text-slate-600">{label}</span>
      <input
        type="number"
        value={value}
        onChange={onChange}
        className="w-full rounded-lg border border-slate-200 px-3 py-2 focus:border-brand focus:outline-none"
      />
    </label>
  );
}

function Stat({
  label,
  value,
  highlight,
  tone,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  tone?: 'good' | 'bad';
}) {
  const valueColor =
    tone === 'good' ? 'text-emerald-600' : tone === 'bad' ? 'text-rose-600' : 'text-slate-900';
  return (
    <div className={`rounded-xl p-4 ${highlight ? 'bg-brand/5' : 'bg-slate-50'}`}>
      <div className="text-sm text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${valueColor}`}>{value}</div>
    </div>
  );
}

export type { Money };
