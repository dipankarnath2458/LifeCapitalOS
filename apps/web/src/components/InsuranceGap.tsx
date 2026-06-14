'use client';

import { useState } from 'react';
import { analyzeLifeInsuranceGap, formatMoney } from '@lcos/core';
import { NumberField, parseField } from './NumberField';

/** Insurance Gap analysis — term-life cover shortfall, client-side via @lcos/core. */
export function InsuranceGap() {
  const [form, setForm] = useState({
    annualIncome: '2000000',
    liabilities: '5000000',
    existingCover: '5000000',
    dependents: '2',
  });
  const [result, setResult] = useState<ReturnType<typeof analyzeLifeInsuranceGap> | null>(null);

  function run() {
    setResult(
      analyzeLifeInsuranceGap({
        annualIncomeMinor: parseField(form.annualIncome) * 100,
        outstandingLiabilitiesMinor: parseField(form.liabilities) * 100,
        existingCoverMinor: parseField(form.existingCover) * 100,
        dependents: parseField(form.dependents),
        currency: 'INR',
      }),
    );
  }

  const set = (k: keyof typeof form) => (v: string) => setForm({ ...form, [k]: v });

  return (
    <div className="grid gap-8 md:grid-cols-2">
      <div className="rounded-2xl bg-white p-6 shadow">
        <h3 className="mb-4 text-lg font-semibold">Your protection</h3>
        <div className="grid grid-cols-2 gap-4">
          <NumberField label="Annual income (₹)" value={form.annualIncome} onChange={set('annualIncome')} />
          <NumberField label="Outstanding loans (₹)" value={form.liabilities} onChange={set('liabilities')} />
          <NumberField label="Existing term cover (₹)" value={form.existingCover} onChange={set('existingCover')} />
          <NumberField label="Dependents" mode="integer" value={form.dependents} onChange={set('dependents')} />
        </div>
        <button
          onClick={run}
          className="mt-6 w-full rounded-xl bg-brand px-4 py-3 font-semibold text-white hover:bg-brand-dark"
        >
          Find my gap
        </button>
      </div>

      <div className="rounded-2xl bg-white p-6 shadow">
        <h3 className="mb-4 text-lg font-semibold">Your insurance gap</h3>
        {!result ? (
          <p className="text-slate-500">See whether your family is adequately protected.</p>
        ) : (
          <div className="space-y-4">
            <Stat label="Recommended cover" value={formatMoney(result.recommendedCoverMinor)} highlight />
            <Stat label="Existing cover" value={formatMoney(result.existingCoverMinor)} />
            <Stat
              label="Shortfall"
              value={formatMoney(result.shortfallMinor)}
              tone={result.adequate ? 'good' : 'bad'}
            />
            <p
              className={`rounded-lg p-3 text-sm ${
                result.adequate ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
              }`}
            >
              {result.adequate
                ? 'Your term cover looks adequate for your income and liabilities. ✅'
                : 'Your family is underprotected. Consider increasing your term cover by the shortfall above.'}
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
