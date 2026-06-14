'use client';

import { useState } from 'react';
import { computeRetirement, formatMoney, type Money } from '@lcos/core';
import { NumberField, parseField } from './NumberField';

/** Retirement Readiness calculator — runs client-side via the shared @lcos/core engine. */
export function RetirementCalculator() {
  const [form, setForm] = useState({
    currentAge: '32',
    retirementAge: '60',
    yearsInRetirement: '25',
    annualExpenses: '1200000',
    currentCorpus: '2000000',
    inflationRatePct: '6',
    preReturnPct: '11',
    postReturnPct: '7',
  });
  const [result, setResult] = useState<ReturnType<typeof computeRetirement> | null>(null);

  function run() {
    setResult(
      computeRetirement({
        currentAge: parseField(form.currentAge),
        retirementAge: parseField(form.retirementAge),
        yearsInRetirement: parseField(form.yearsInRetirement),
        currentAnnualExpensesMinor: parseField(form.annualExpenses) * 100,
        currentCorpusMinor: parseField(form.currentCorpus) * 100,
        inflationRatePct: parseField(form.inflationRatePct),
        preRetirementReturnPct: parseField(form.preReturnPct),
        postRetirementReturnPct: parseField(form.postReturnPct),
        currency: 'INR',
      }),
    );
  }

  const set = (k: keyof typeof form) => (v: string) => setForm({ ...form, [k]: v });

  return (
    <div className="grid gap-8 md:grid-cols-2">
      <div className="rounded-2xl bg-white p-6 shadow">
        <h3 className="mb-4 text-lg font-semibold">Your retirement plan</h3>
        <div className="grid grid-cols-2 gap-4">
          <NumberField label="Current age" mode="integer" value={form.currentAge} onChange={set('currentAge')} />
          <NumberField label="Retirement age" mode="integer" value={form.retirementAge} onChange={set('retirementAge')} />
          <NumberField label="Years in retirement" mode="integer" value={form.yearsInRetirement} onChange={set('yearsInRetirement')} />
          <NumberField label="Annual expenses (₹)" value={form.annualExpenses} onChange={set('annualExpenses')} />
          <NumberField label="Current corpus (₹)" value={form.currentCorpus} onChange={set('currentCorpus')} />
          <NumberField label="Inflation %" mode="decimal" value={form.inflationRatePct} onChange={set('inflationRatePct')} />
          <NumberField label="Return before (%)" mode="decimal" value={form.preReturnPct} onChange={set('preReturnPct')} />
          <NumberField label="Return after (%)" mode="decimal" value={form.postReturnPct} onChange={set('postReturnPct')} />
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
