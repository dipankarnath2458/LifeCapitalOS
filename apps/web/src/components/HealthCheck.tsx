'use client';

import { useState } from 'react';
import { computeWealthHealth, topWealthActions, type WealthHealthReport } from '@lcos/core';

/**
 * Wealth Health Check — the lead-generation engine. Runs entirely client-side using
 * the shared @lcos/core scoring, so it delivers an instant score with no signup.
 */
const BAND_COLOR: Record<string, string> = {
  green: 'bg-emerald-500',
  yellow: 'bg-amber-500',
  red: 'bg-rose-500',
};

export function HealthCheck() {
  const [form, setForm] = useState({
    age: 35,
    monthlyExpenses: 50000,
    emergencyFund: 150000,
    annualIncome: 2000000,
    lifeCover: 5000000,
    hasHealthInsurance: true,
    investments: 1000000,
    totalAssets: 10000000,
    totalLiabilities: 3000000,
  });
  const [report, setReport] = useState<WealthHealthReport | null>(null);

  function run() {
    const r = computeWealthHealth({
      age: form.age,
      monthlyExpensesMinor: form.monthlyExpenses * 100,
      emergencyFundMinor: form.emergencyFund * 100,
      annualIncomeMinor: form.annualIncome * 100,
      existingLifeCoverMinor: form.lifeCover * 100,
      hasHealthInsurance: form.hasHealthInsurance,
      investmentAssetsMinor: form.investments * 100,
      totalAssetsMinor: form.totalAssets * 100,
      totalLiabilitiesMinor: form.totalLiabilities * 100,
      retirementRequiredCorpusMinor: 0,
      retirementCorpusGapMinor: 0,
    });
    setReport(r);
  }

  const num = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: Number(e.target.value) });

  return (
    <div className="grid gap-8 md:grid-cols-2">
      <div className="rounded-2xl bg-white p-6 shadow">
        <h3 className="mb-4 text-lg font-semibold">Your numbers</h3>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Age" value={form.age} onChange={num('age')} />
          <Field label="Monthly expenses (₹)" value={form.monthlyExpenses} onChange={num('monthlyExpenses')} />
          <Field label="Emergency fund (₹)" value={form.emergencyFund} onChange={num('emergencyFund')} />
          <Field label="Annual income (₹)" value={form.annualIncome} onChange={num('annualIncome')} />
          <Field label="Life cover (₹)" value={form.lifeCover} onChange={num('lifeCover')} />
          <Field label="Investments (₹)" value={form.investments} onChange={num('investments')} />
          <Field label="Total assets (₹)" value={form.totalAssets} onChange={num('totalAssets')} />
          <Field label="Total liabilities (₹)" value={form.totalLiabilities} onChange={num('totalLiabilities')} />
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
              {report.subScores.map((s) => (
                <div key={s.key}>
                  <div className="flex justify-between text-sm">
                    <span>{s.label}</span>
                    <span className="font-medium">{s.score}</span>
                  </div>
                  <div className="h-2 w-full rounded bg-slate-100">
                    <div
                      className={`h-2 rounded ${BAND_COLOR[s.band]}`}
                      style={{ width: `${s.score}%` }}
                    />
                  </div>
                </div>
              ))}
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
