'use client';

import { useState } from 'react';
import { computeWealthHealth, topWealthActions, type WealthHealthReport } from '@lcos/core';
import { NumberField, parseField } from './NumberField';
import { BAND_META, type Band } from './Status';

export function HealthCheck() {
  // Values are kept as sanitized digit strings; NumberField formats them for display.
  const [form, setForm] = useState({
    age: '35',
    monthlyExpenses: '50000',
    emergencyFund: '150000',
    annualIncome: '2000000',
    lifeCover: '5000000',
    hasHealthInsurance: true,
    investments: '1000000',
    totalAssets: '10000000',
    totalLiabilities: '3000000',
  });
  const [report, setReport] = useState<WealthHealthReport | null>(null);

  function run() {
    const r = computeWealthHealth({
      age: parseField(form.age),
      monthlyExpensesMinor: parseField(form.monthlyExpenses) * 100,
      emergencyFundMinor: parseField(form.emergencyFund) * 100,
      annualIncomeMinor: parseField(form.annualIncome) * 100,
      existingLifeCoverMinor: parseField(form.lifeCover) * 100,
      hasHealthInsurance: form.hasHealthInsurance,
      investmentAssetsMinor: parseField(form.investments) * 100,
      totalAssetsMinor: parseField(form.totalAssets) * 100,
      totalLiabilitiesMinor: parseField(form.totalLiabilities) * 100,
      retirementRequiredCorpusMinor: 0,
      retirementCorpusGapMinor: 0,
    });
    setReport(r);
  }

  const set = (k: keyof typeof form) => (v: string) => setForm({ ...form, [k]: v });

  return (
    <div className="grid gap-8 md:grid-cols-2">
      <div className="rounded-2xl bg-white p-6 shadow">
        <h3 className="mb-4 text-lg font-semibold">Your numbers</h3>
        <div className="grid grid-cols-2 gap-4">
          <NumberField label="Age" mode="integer" value={form.age} onChange={set('age')} />
          <NumberField label="Monthly expenses (₹)" value={form.monthlyExpenses} onChange={set('monthlyExpenses')} />
          <NumberField label="Emergency fund (₹)" value={form.emergencyFund} onChange={set('emergencyFund')} />
          <NumberField label="Annual income (₹)" value={form.annualIncome} onChange={set('annualIncome')} />
          <NumberField label="Life cover (₹)" value={form.lifeCover} onChange={set('lifeCover')} />
          <NumberField label="Investments (₹)" value={form.investments} onChange={set('investments')} />
          <NumberField label="Total assets (₹)" value={form.totalAssets} onChange={set('totalAssets')} />
          <NumberField label="Total liabilities (₹)" value={form.totalLiabilities} onChange={set('totalLiabilities')} />
        </div>
        <label className="mt-4 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.hasHealthInsurance}
            onChange={(e) => setForm({ ...form, hasHealthInsurance: e.target.checked })}
          />
          I have health insurance
        </label>
        <button
          onClick={run}
          className="mt-6 w-full rounded-xl bg-brand px-4 py-3 font-semibold text-white hover:bg-brand-dark"
        >
          Check my financial health
        </button>
      </div>

      <div className="rounded-2xl bg-white p-6 shadow">
        <h3 className="mb-4 text-lg font-semibold">Your Wealth Health</h3>
        {!report ? (
          <p className="text-slate-500">Enter your numbers and get an instant score.</p>
        ) : (
          <div>
            <div className="mb-6 flex items-baseline gap-2">
              <span className="text-5xl font-bold text-brand">{report.overall}</span>
              <span className="text-slate-500">/ 100 overall</span>
            </div>
            <div className="space-y-3">
              {report.subScores.map((s) => {
                const band = s.band as Band;
                return (
                  <div key={s.key}>
                    <div className="flex justify-between text-sm">
                      <span>{s.label}</span>
                      <span className="font-medium">
                        {s.score}
                        <span className={`ml-2 text-xs font-medium ${BAND_META[band].text}`}>
                          {BAND_META[band].label}
                        </span>
                      </span>
                    </div>
                    <div
                      className="h-2 w-full rounded bg-slate-100"
                      role="progressbar"
                      aria-label={`${s.label}: ${s.score} of 100, ${BAND_META[band].label}`}
                      aria-valuenow={s.score}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    >
                      <div className={`h-2 rounded ${BAND_META[band].dot}`} style={{ width: `${s.score}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-6">
              <h4 className="mb-2 font-semibold">Top actions</h4>
              <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
                {topWealthActions(report).map((a) => (
                  <li key={a.priority}>{a.title}</li>
                ))}
              </ol>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
